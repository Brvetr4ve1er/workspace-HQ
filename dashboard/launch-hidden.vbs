' WorkspaceHQ silent launcher — starts the Electron dashboard minimized to the
' system tray (--hidden) with no console window. Used by the Startup-folder
' shortcut so WorkspaceHQ is the always-on main dashboard at login.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
electron = dir & "\node_modules\electron\dist\electron.exe"
' arg 0 to electron is the app dir ("."), then --hidden for start-to-tray
sh.CurrentDirectory = dir
sh.Run """" & electron & """ . --hidden", 0, False
