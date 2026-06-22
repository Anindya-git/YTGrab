/**
 * YTGrab — Beautiful yt-dlp GUI
 * Run: deno run --allow-net --allow-run --allow-read --allow-write --allow-env main.ts
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { join, dirname, fromFileUrl } from "https://deno.land/std@0.208.0/path/mod.ts";

const PORT = 7979;

// Works on Windows (USERPROFILE) and Unix (HOME)
const HOME_DIR = Deno.env.get("USERPROFILE") || Deno.env.get("HOME") || ".";
const HISTORY_FILE = join(HOME_DIR, ".ytgrab_history.json");
const SETTINGS_FILE = join(HOME_DIR, ".ytgrab_settings.json");

// ─── Utility ──────────────────────────────────────────────────────────────────

async function runCommand(cmd: string[]): Promise<{ stdout: string; stderr: string; success: boolean }> {
  try {
    const proc = new Deno.Command(cmd[0], {
      args: cmd.slice(1),
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout, stderr, success } = await proc.output();
    return {
      stdout: new TextDecoder().decode(stdout).trim(),
      stderr: new TextDecoder().decode(stderr).trim(),
      success,
    };
  } catch (e) {
    return { stdout: "", stderr: String(e), success: false };
  }
}

async function readJSON(path: string, fallback: unknown = null) {
  try {
    const text = await Deno.readTextFile(path);
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function writeJSON(path: string, data: unknown) {
  await Deno.writeTextFile(path, JSON.stringify(data, null, 2));
}

// ─── API Handlers ─────────────────────────────────────────────────────────────

async function detectTools() {
  const tools: Record<string, { found: boolean; version: string }> = {};
  for (const tool of ["yt-dlp", "ffmpeg", "deno"]) {
    const r = await runCommand([tool, "--version"]);
    tools[tool] = {
      found: r.success,
      version: r.success ? r.stdout.split("\n")[0] : "Not found",
    };
  }
  return tools;
}

async function fetchInfo(url: string, proxy?: string) {
  const args = ["yt-dlp", "--dump-json", "--flat-playlist", "--no-warnings"];
  if (proxy) args.push("--proxy", proxy);
  args.push(url);
  const r = await runCommand(args);
  if (!r.success) throw new Error(r.stderr || "Failed to fetch info");

  // Handle playlist (multiple JSON lines) vs single video
  const lines = r.stdout.split("\n").filter(l => l.trim().startsWith("{"));
  if (lines.length === 0) throw new Error("No video info returned");

  const items = lines.map(l => JSON.parse(l));
  if (items.length === 1) {
    // Single video — get full format info
    return { type: "video", data: items[0] };
  }
  return { type: "playlist", data: items };
}

async function fetchFormats(url: string, proxy?: string) {
  const args = ["yt-dlp", "-J", "--no-warnings"];
  if (proxy) args.push("--proxy", proxy);
  args.push(url);
  const r = await runCommand(args);
  if (!r.success) throw new Error(r.stderr || "Failed to fetch formats");
  return JSON.parse(r.stdout);
}

async function buildDownloadCommand(opts: {
  url: string;
  outputDir: string;
  formatId?: string;
  audioOnly?: boolean;
  audioFormat?: string;
  audioLanguages?: string[];
  subtitleLangs?: string[];
  embedSubs?: boolean;
  embedThumbnail?: boolean;
  saveDescription?: boolean;
  embedChapters?: boolean;
  proxy?: string;
  playlistItems?: string;
  videoFormat?: string;
  fps?: number;
  hdr?: boolean;
}): Promise<string[]> {
  const cmd: string[] = ["yt-dlp"];

  if (opts.audioOnly) {
    cmd.push("-x");
    if (opts.audioFormat) cmd.push("--audio-format", opts.audioFormat);
    else cmd.push("--audio-format", "mp3");
    cmd.push("--audio-quality", "0");
  } else if (opts.formatId && opts.formatId !== "best") {
    cmd.push("-f", opts.formatId);
  } else {
    // Smart format selection
    let fmt = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best";
    if (opts.fps) {
      const res = opts.videoFormat || "1080";
      fmt = `bestvideo[height<=${res}][fps<=${opts.fps}]+bestaudio/best`;
    } else if (opts.videoFormat) {
      const res = opts.videoFormat.replace("p", "");
      fmt = `bestvideo[height<=${res}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${res}]+bestaudio/best[height<=${res}]`;
    }
    if (opts.hdr) {
      fmt = fmt.replace("bestvideo", "bestvideo[dynamic_range=HDR10]");
    }
    cmd.push("-f", fmt);
    cmd.push("--merge-output-format", "mp4");
  }

  if (opts.audioLanguages && opts.audioLanguages.length > 0) {
    for (const lang of opts.audioLanguages) {
      cmd.push("--audio-multistreams");
    }
  }

  if (opts.subtitleLangs && opts.subtitleLangs.length > 0) {
    cmd.push("--write-subs", "--sub-langs", opts.subtitleLangs.join(","));
    if (opts.embedSubs) cmd.push("--embed-subs");
  }

  if (opts.embedThumbnail) cmd.push("--embed-thumbnail");
  if (opts.saveDescription) {
    cmd.push("--write-description");
    cmd.push("--write-thumbnail");
  }
  if (opts.embedChapters) cmd.push("--embed-chapters");

  if (opts.proxy) cmd.push("--proxy", opts.proxy);
  if (opts.playlistItems) cmd.push("--playlist-items", opts.playlistItems);

  cmd.push("--progress", "--newline");
  cmd.push("-o", join(opts.outputDir, "%(title)s.%(ext)s"));
  cmd.push(opts.url);

  return cmd;
}

// Active download processes
const activeDownloads = new Map<string, {
  process: Deno.ChildProcess;
  controller: ReadableStreamDefaultController<Uint8Array>;
}>();

// ─── HTTP Handler ─────────────────────────────────────────────────────────────

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });

  if (req.method === "OPTIONS") return new Response(null, { headers });

  // ── Static HTML ────────────────────────────────────────────────────────────
  if (path === "/" || path === "/index.html") {
    const html = await Deno.readTextFile(join(dirname(fromFileUrl(import.meta.url)), "index.html"));
    return new Response(html, { headers: new Headers({ "Content-Type": "text/html; charset=utf-8" }) });
  }

  // ── API Routes ─────────────────────────────────────────────────────────────
  if (path.startsWith("/api/")) {
    headers.set("Content-Type", "application/json");

    try {
      // Tool detection
      if (path === "/api/tools") {
        return new Response(JSON.stringify(await detectTools()), { headers });
      }

      // Update yt-dlp
      if (path === "/api/update-ytdlp" && req.method === "POST") {
        const r = await runCommand(["yt-dlp", "-U"]);
        return new Response(JSON.stringify({ success: r.success, output: r.stdout || r.stderr }), { headers });
      }

      // Fetch video info
      if (path === "/api/info" && req.method === "POST") {
        const body = await req.json();
        const info = await fetchInfo(body.url, body.proxy);
        return new Response(JSON.stringify(info), { headers });
      }

      // Fetch formats
      if (path === "/api/formats" && req.method === "POST") {
        const body = await req.json();
        const info = await fetchFormats(body.url, body.proxy);
        return new Response(JSON.stringify(info), { headers });
      }

      // Generate command
      if (path === "/api/command" && req.method === "POST") {
        const body = await req.json();
        const cmd = await buildDownloadCommand(body);
        return new Response(JSON.stringify({ command: cmd.join(" ") }), { headers });
      }

      // Start download with SSE streaming
      if (path === "/api/download" && req.method === "POST") {
        const body = await req.json();
        const downloadId = crypto.randomUUID();
        const cmd = await buildDownloadCommand(body);

        const sseHeaders = new Headers({
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });

        const stream = new ReadableStream({
          async start(controller) {
            const send = (data: unknown) => {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
            };

            send({ type: "start", id: downloadId, command: cmd.join(" ") });

            try {
              const proc = new Deno.Command(cmd[0], {
                args: cmd.slice(1),
                stdout: "piped",
                stderr: "piped",
              });
              const child = proc.spawn();

              const processOutput = async (readable: ReadableStream<Uint8Array>, isErr: boolean) => {
                const reader = readable.getReader();
                let buffer = "";
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  buffer += new TextDecoder().decode(value);
                  const lines = buffer.split("\n");
                  buffer = lines.pop() || "";
                  for (const line of lines) {
                    if (line.trim()) {
                      send({ type: isErr ? "error_line" : "progress", line });
                    }
                  }
                }
                if (buffer.trim()) send({ type: isErr ? "error_line" : "progress", line: buffer });
              };

              await Promise.all([
                processOutput(child.stdout, false),
                processOutput(child.stderr, true),
              ]);

              const status = await child.status;

              // Save to history
              const history = await readJSON(HISTORY_FILE, []) as unknown[];
              history.unshift({
                id: downloadId,
                url: body.url,
                command: cmd.join(" "),
                success: status.success,
                timestamp: new Date().toISOString(),
                title: body.title || "",
                outputDir: body.outputDir,
              });
              await writeJSON(HISTORY_FILE, history.slice(0, 200));

              send({ type: "done", success: status.success, code: status.code });
            } catch (e) {
              send({ type: "error", message: String(e) });
            }

            controller.close();
          },
        });

        return new Response(stream, { headers: sseHeaders });
      }

      // Cancel download
      if (path === "/api/cancel" && req.method === "POST") {
        const body = await req.json();
        const dl = activeDownloads.get(body.id);
        if (dl) {
          dl.process.kill("SIGTERM");
          activeDownloads.delete(body.id);
          return new Response(JSON.stringify({ success: true }), { headers });
        }
        return new Response(JSON.stringify({ success: false, message: "Not found" }), { headers });
      }

      // History
      if (path === "/api/history") {
        const history = await readJSON(HISTORY_FILE, []);
        return new Response(JSON.stringify(history), { headers });
      }

      if (path === "/api/history/clear" && req.method === "POST") {
        await writeJSON(HISTORY_FILE, []);
        return new Response(JSON.stringify({ success: true }), { headers });
      }

      // Settings
      if (path === "/api/settings") {
        if (req.method === "GET") {
          const settings = await readJSON(SETTINGS_FILE, {
            outputDir: join(HOME_DIR, "Downloads"),
            proxy: "",
            theme: "obsidian",
            embedThumbnail: true,
            embedChapters: true,
            saveDescription: false,
          });
          return new Response(JSON.stringify(settings), { headers });
        }
        if (req.method === "POST") {
          const body = await req.json();
          await writeJSON(SETTINGS_FILE, body);
          return new Response(JSON.stringify({ success: true }), { headers });
        }
      }

      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers });

    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers });
    }
  }

  return new Response("Not found", { status: 404 });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(`\n🎬 YTGrab starting on http://localhost:${PORT}\n`);

// Auto-open browser (platform-safe)
try {
  if (Deno.build.os === "windows") {
    new Deno.Command("cmd", { args: ["/c", "start", `http://localhost:${PORT}`] }).spawn();
  } else if (Deno.build.os === "darwin") {
    new Deno.Command("open", { args: [`http://localhost:${PORT}`] }).spawn();
  } else {
    new Deno.Command("xdg-open", { args: [`http://localhost:${PORT}`] }).spawn();
  }
} catch (_) { /* ignore if auto-open fails */ }

await serve(handler, { port: PORT });
