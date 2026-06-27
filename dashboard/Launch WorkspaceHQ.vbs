' WorkspaceHQ visible launcher — double-click to open the dashboard window on
' your desktop (no --hidden, so the window shows instead of going to the tray).
' For testing; the Startup-folder shortcut uses launch-hidden.vbs instead.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
electron = dir & "\node_modules\electron\dist\electron.exe"
sh.CurrentDirectory = dir
sh.Run """" & electron & """ .", 1, False
