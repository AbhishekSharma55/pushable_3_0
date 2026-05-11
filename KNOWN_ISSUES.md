# Known Issues & Limitations

A running list of rough edges and follow-up work. These do not block core
functionality but are tracked for the next iteration.

## Open

| Area | Issue |
|------|-------|
| Files (MinIO) | `PUT /files/:id` (update file) does not persist new content correctly — workaround: delete + re-upload |
| Multi-agent chat | Messages between collaborating agents are not visually separated in the chat UI |
| Tools | Python sandbox tool occasionally hangs in the "loading" state in the UI even after the backend has returned |
| Workflows | Workflows fail to save when the selected model is `gemini-3-flash-preview` |
| Workflows | Intermittent execution errors when a workflow step calls another agent — needs better retry/error surface |
| Workflows (small LLMs) | Smaller models produced poor workflow plans; mitigated by prompt + model-size guardrails, but quality still lags larger models |

## Vendored upstream

`camoufox-main/` is a vendored snapshot of the [Camoufox](https://github.com/daijro/camoufox)
anti-detect browser, included so the browser-service Docker image can build the
custom Python bindings (`camoufox-main/pythonlib`). Only `pythonlib/` is needed
at runtime; the `bundle/`, `additions/`, `patches/`, and `tests/` subtrees are
upstream build artifacts kept for reproducibility.

Future cleanup: extract `pythonlib/` into `vendor/camoufox-pythonlib/` and drop
the rest, or replace with a pinned Git submodule.
