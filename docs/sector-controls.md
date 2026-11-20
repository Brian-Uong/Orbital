# Roadmap sector controls

Each owner Roadmap card has Pause sector / Resume sector. A paused sector retains its tasks, approvals and evidence. Other sectors continue. Active work stops at its next safe checkpoint; this is not process termination. Resume makes work eligible on the existing hourly coordinator, not an immediate run. Global Pause overrides every sector; global Resume does not clear individual pauses.

Owner-only `POST /api/sector-control` accepts `{sectorId, paused}` with a fresh owner state ETag in `If-Match` and same-origin access. The sector must exist. Repeating the same setting is idempotent. State persists in `commandCenter.sectorControls[sectorId]` as `{paused,updatedAt,source}`. Missing means enabled. Normal state PUTs must preserve this map exactly. Public state omits controls.

Before selecting, claiming or performing another work/release/revision step, the hourly coordinator reads fresh controls and skips sectors with `paused === true` or all sectors when `workflowControl.paused === true`. Retain queues and reconcile in-flight work at a safe checkpoint. Do not spawn, start new assignments, publish queued releases or execute repairs for a paused sector. Resolve releases to their actual sector ID; never guess from an unrelated default. The API rejects new task, release and revision claims while paused. Existing work may still record completion or checkpoint evidence. These controls do not stop independent external data collectors or other scheduled automations.

Synthetic API and UI-handler tests cover permissions, concurrency, idempotency, retained queues, independent settings, global precedence, claim guards, readback, and error feedback. No real sector setting is toggled during tests.
