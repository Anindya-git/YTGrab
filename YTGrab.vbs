Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Get the folder where this .vbs file lives
strDir = objFSO.GetParentFolderName(WScript.ScriptFullName)

' Run: deno run ... main.ts  in a normal visible cmd window, starting in that folder
strCmd = "cmd.exe /k ""cd /d """ & strDir & """ && deno run --allow-net --allow-run --allow-read --allow-write --allow-env main.ts"""

objShell.Run strCmd, 1, False
