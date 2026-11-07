@rem WorkspaceHQ - started by claude-resume.js in a NEW terminal: start "" cmd /d /v:off /k this-file
@rem The session folder arrives as the working directory. The session id arrives as the
@rem HQ_RESUME_ID environment variable, the fixed word continue as HQ_RESUME_PROMPT and an
@rem optional MCP config file as HQ_MCP_CONFIG, so no id or path is ever on a cmd command line.
@rem The permission mode is always explicit: the global default is auto and a missing flag inherits it.
@rem Branches use labels, never an if block, so a closing parenthesis in a value cannot end a block.
@setlocal DisableDelayedExpansion
@if defined HQ_MCP_CONFIG goto withmcp
@if defined HQ_RESUME_PROMPT goto plainsay
@claude --resume "%HQ_RESUME_ID%" --permission-mode default
@goto done
:plainsay
@claude --resume "%HQ_RESUME_ID%" --permission-mode default "%HQ_RESUME_PROMPT%"
@goto done
:withmcp
@if defined HQ_RESUME_PROMPT goto withmcpsay
@claude --resume "%HQ_RESUME_ID%" --permission-mode default --mcp-config "%HQ_MCP_CONFIG%"
@goto done
:withmcpsay
@claude --resume "%HQ_RESUME_ID%" --permission-mode default "%HQ_RESUME_PROMPT%" --mcp-config "%HQ_MCP_CONFIG%"
:done
