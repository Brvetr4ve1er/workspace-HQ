@rem WorkspaceHQ - started by claude-launch.js in a NEW terminal: start "" cmd /d /v:off /k this-file
@rem The project folder arrives as the working directory, the seed prompt as the HQ_LAUNCH_PROMPT environment
@rem variable and an optional MCP config file as HQ_MCP_CONFIG, so neither is ever on a cmd command line.
@rem Percent expansion is single-pass and the prompt holds no double quotes or control characters, so shell
@rem operators inside the quotes stay plain text. Delayed expansion is off, so the npm claude.cmd shim does not
@rem re-expand exclamation marks in the prompt.
@rem The permission mode is always explicit: the global default is auto and a missing flag inherits it.
@rem --mcp-config goes LAST (it is variadic). Branches use labels, never an if block, so a closing parenthesis
@rem in a value cannot end a block. launch-tools.js buildArgs produces exactly these flags.
@setlocal DisableDelayedExpansion
@if defined HQ_MCP_CONFIG goto withmcp
@claude "%HQ_LAUNCH_PROMPT%" --permission-mode default
@goto done
:withmcp
@claude "%HQ_LAUNCH_PROMPT%" --permission-mode default --mcp-config "%HQ_MCP_CONFIG%"
:done
