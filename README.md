# 🎬 YTGrab — Beautiful yt-dlp GUI

A macOS-inspired dark-themed GUI for yt-dlp. Runs entirely in your browser, served locally by Deno. Works on **Windows, macOS, and Linux**.

---

## Requirements

| Tool | Windows Install |
|------|----------------|
| **Deno** | `winget install DenoLand.Deno` or https://deno.com |
| **yt-dlp** | `winget install yt-dlp` or `pip install yt-dlp` |
| **ffmpeg** | `winget install ffmpeg` (needed for merging & conversion) |

> All three can also be installed via **Scoop**: `scoop install deno yt-dlp ffmpeg`

---

## Quick Start (Windows)

**Option 1 — Double-click:**
```
run.bat
```

**Option 2 — Command Prompt / PowerShell:**
```bat
deno run --allow-net --allow-run --allow-read --allow-write --allow-env main.ts
```

The app opens automatically at **http://localhost:7979**

---

## Features

### Download Tab
- Paste any yt-dlp-compatible URL (YouTube, Vimeo, Twitter/X, etc.)
- **Video mode** — choose resolution (up to 8K), FPS cap, HDR preference
- **Audio Only** — extract as MP3, FLAC, M4A, Opus, WAV, AAC, etc.
- **Custom Format** — raw yt-dlp format strings like `137+140`
- Subtitle language selection with embed support
- Multiple audio language tracks
- Embed thumbnail, save description, embed chapters toggles
- Output directory + proxy configuration
- **Terminal command preview** with one-click copy
- Real-time download log with progress bar

### Formats Tab
- Full format table (resolution, FPS, codec, bitrate, size, HDR badge)
- Click any row to use that format ID on the Download tab

### History Tab
- Persistent history saved to `%USERPROFILE%\.ytgrab_history.json`
- Shows success/failure, timestamp, URL, and exact command used
- Click a command to copy it; "Reuse URL" loads it back

### Updater Tab
- One-click `yt-dlp -U` with live output

### Settings Tab
- **5 dark themes**: Obsidian, Midnight, Graphite, Aurora, Rosewood
- Default output directory, proxy, and toggle defaults
- Saved to `%USERPROFILE%\.ytgrab_settings.json`

### Sidebar
- Live tool status for yt-dlp, ffmpeg, and deno with version display

---

## Files

```
ytdlp-gui/
├── main.ts     ← Deno server (API + file serving)
├── index.html  ← Full GUI frontend
├── run.bat     ← Windows launcher (double-click to start)
└── README.md   ← This file
```

---

## Playlist Support

Fetching a playlist URL shows a numbered checklist. Check/uncheck individual videos. The selection converts automatically to yt-dlp's `--playlist-items` syntax.

---

## Proxy

Supports HTTP, HTTPS, SOCKS4, and SOCKS5:
- `http://host:port`
- `socks5://user:pass@host:port`
