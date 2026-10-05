@rem WorkspaceHQ - started by claude-launch.js in a NEW terminal: start "" cmd /d /v:off /k this-file
@rem The project folder arrives as the working directory and the seed prompt as the
@rem HQ_LAUNCH_PROMPT environment variable, so neither is ever on a cmd command line.
@rem Percent expansion is single-pass and the value holds no double quotes or control
@rem characters, so shell operators inside the quotes stay plain text. Delayed expansion
@rem is off, so the npm claude.cmd shim does not re-expand exclamation marks in the prompt.
@setlocal DisableDelayedExpansion
@claude "%HQ_LAUNCH_PROMPT%"
