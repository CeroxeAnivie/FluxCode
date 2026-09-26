# Windows interactive terminal acceptance

Actual debug FluxCode, WebView2, xterm and bundled Codex 0.156.1 were exercised
through CDP. No production model request or Computer Use was involved. The
script uses an isolated directory and declares its Python and Git/less tools.

Ten checks passed in `work/native-terminal-1790334459672/result.json`:

- PowerShell Unicode/CJK input and output.
- Python interactive REPL execution and return to the PowerShell prompt.
- Ctrl+C stops a foreground sleep and leaves the shell usable.
- Hiding and reopening the dock preserves a shell variable.
- Native maximize/restore updates ConPTY columns (105 to 137 in this run).
- Git output and subsequent shell commands work.
- less enters full-screen paging, reaches the last of 150 lines, and returns
  to the shell with the normal screen buffer restored.
- Restarting a terminal opens a usable new shell.
- Ending the session releases the native terminal slot and terminates a real
  Python descendant whose PID was recorded before termination.
- Closing the application after sessions end produces process exit code zero.

The distinction between hiding the terminal panel and ending its session matters:
the former intentionally preserves the process. Earlier test attempts clicked
hide and then waited for application exit while the native exit confirmation was
pending. That was a test mistake, not verified cleanup. The final script clicks
the explicit end-session button and checks both resource count and descendant
exit. It does not weaken the exit assertion.

The clear-output button was fixed to target the selected terminal mode. Clearing
interactive output preserves its live prompt/process; a focused browser regression
passed. Tests also cover terminal foreground resizing and preserving multiple
sessions across dock hiding. This finite matrix does not certify every third-party
TUI, screen reader, terminal protocol or remote shell.

After installing the patched Codex 0.157.0 pair and rebuilding the standalone
Tauri debug desktop, all ten checks passed again on 2026-09-26. Evidence:
`work/native-terminal-1790404633714/result.json`. This verifies the engine upgrade
against the existing finite PTY contract; it does not expand the matrix.
