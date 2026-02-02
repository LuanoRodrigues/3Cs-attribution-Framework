# Coder State Removal

We removed the legacy `coder_state.json` ingestion pipeline. LEditor now expects content to be supplied explicitly (e.g., via `initialContent`) or through normal document import/export flows. The old auto-loading path, autosave, and associated logs are disabled and slated for deletion.

Implications:
- No background reads of `coder_state.json` or bridge/host fetches.
- Autosave to coder_state is disabled; rely on the editor's own persistence/export.
- Debug logs prefixed with `[CoderState]` / `[text][loader]` / `[text][keys]` / `[text][preview]` are gone.

If you still need coder_state-style imports, add a dedicated import command or extension rather than re-enabling the legacy path.
