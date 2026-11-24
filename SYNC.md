# Orbital sector state

The command center owns the six-hour report. The station opens the latest saved snapshot. The desktop service returns it at GET /api/state.

| Field | Meaning |
| --- | --- |
| updatedAt | UTC ISO timestamp of the saved report |
| commandCenter | Coordinator name and reporting cadence |
| agents | Five sector records for Professional, Stella Zhang, Personal Dashboard, Personal Website and Financial Advice |
| events | Timestamped assignment, result and review records with stable event IDs |
| reports | Six-hour reports, each with a timestamp, summary and sector results |

Each sector uses a stable id and sourceType `sector`. The name identifies the project. The task field records the current assignment, and detail describes the observed result or obstacle. Use the verified project or thread identifier where available. Record the last observed activity independently of the next planned review. An assigned task can have a known issue time before any result exists.

Keep prior verified results when a source is unavailable. Mark work completed only after a real outcome can be identified. Preserve existing event IDs during reconciliation so that retries do not duplicate activity. Keep private conversation excerpts, credentials and raw agent output out of the station.

## Update the hosted station

Use the public Orbital Site with owner-only private data identified by the project ID in .openai/hosting.json. Obtain its current deployed URL and service bearer from Sites. Verify owner access and the site origin before sending credentials. Requests to this exact HTTPS origin must reject redirects. Send the service bearer in OAI-Sites-Authorization using the Bearer scheme. For Orbit-Sync-Key send the lowercase hexadecimal SHA-256 of the UTF-8 string `orbit-sync-v1:` concatenated with that bearer. Keep both header values in memory.

Read GET /api/state and retain its ETag. Send the accepted canonical JSON to PUT /api/state with the same two authorization headers, Content-Type application/json and If-Match set to that ETag. Read the state again and compare the saved revision, routes, assignment IDs and result timestamps. If the state is newer or changed concurrently, reread both sources and reconcile the newer observations with existing event and report IDs. Ordinary sector updates require no deployment.

## Improve the website

Keep a short list of ideas grounded in the actual workflow. Start with the time it takes to find a blocked agent, open its task, or recover the last result. Each six-hour briefing, choose one specific improvement from the current experience, write a success condition, implement it against the latest Orbital source, and exercise it on desktop and mobile widths. Check status freshness, navigation and privacy on affected screens.

Orbital Build automatically publishes tested station UI and maintenance changes to this Site. Keep its release records in commandCenter.websiteImprovements.backlog under Orbital Build. After each deployment, update `Brian-Uong/Orbital` on `main` with the corresponding public source and verify the changed files. Record the Sites version, hosted commit, live URL and GitHub commit on the release. Retry an outstanding mirror against the same deployed revision. The public repository uses sample data, a generic source bootstrap and a hosting template. Project releases for the other sectors continue through Needs Brian.


## Public viewing and owner access

Visitors can read the five sector names and coarse statuses. The public response omits tasks, private evidence, conversation routes, activity and briefing contents. Sites supplies authenticated browser identity. Configure ORBIT_OWNER_EMAIL as a server-only secret using the verified owner email from the Site access policy. An empty setting grants no browser owner privileges. Top-level Owner sign in opens the platform sign-in flow.

Owner updates require a same-origin browser request. The authorized sync service retains its existing writer key. Both use If-Match for changes to the project feed. Before state sync, confirm the exact HTTPS origin, owner role and the owner's selected public audience. Verify the sanitized public response independently of the authenticated readback.

## Worker offices in Command

Current coordination uses verified original project conversations. The worker instructions below describe historical records only and do not authorize creating or reusing Work specialists. Preserve `projectConversationReceipts` and `workflowTransitions` by stable ID and original contents; append later observations with new IDs. The service rejects lost or rewritten evidence.

Before creating or changing an `awaiting owner approval` review, include the evaluator's PASS for that exact review, action, destination and artifact. A prior branch/PR PASS does not establish a merge or deployment PASS. Keep incomplete evaluations in private intake and never report a hidden review as an actionable owner decision.

After verified release, reconcile its matching assignment by project and artifact digest, retaining the original claim and evidence. Update stale waiting text to the authorized outcome (PR, deployment or manual review). Include the actual release timestamp and a verified result URL. Station maintenance accepts `githubUrl` or `mirrorUrl`; do not substitute a guessed midnight timestamp for an unknown completion time.

The Work runner owns the private execution ledger. The hosted station reads the accepted project snapshot from `GET /api/state`. A full ledger travels with owner and service reads. Anonymous and other visitor reads expose the project names and coarse statuses only.

The tower groups explicitly identified executors by project and handle. Repeated reports for a handle update the same office. Historical reports supply the last reported activity. Only a recent working signal tied to that executor can animate their desk. A project thread, folder reference, queued assignment or uncredited result cannot establish that a worker is present. Work without an executor identity remains a coverage gap. Viewing an office does not start a job or write a heartbeat.


### Register observed worker lifecycles

The coordinator receives an executor handle from its Work creation or assignment operation. As soon as it learns that handle and its real project, it publishes a receipt, before waiting for completion. An intended role or queued task without an executor is insufficient. The visualization reads the receipt. It never dispatches work or discovers other ChatGPT sessions.

Write structured receipts to a private JSON array. Each row contains a verified project slug and name (`projectId`, `projectName`), the exact `executorId`, `type`, ISO UTC `at`, execution `source`, and a stable `id` or `observationKey`. Optional fields are `tag`, one-line `activity` and `artifactUrl`. Preserve the original observation time and contents on retries. Record a subsequent transition as a new receipt. Use `created` or `assigned` for first registration, `started` or `progress` for observed work, and `completed`, `idle`, `failed`, `blocked` or `waiting` as appropriate when it ends. An actual first use can begin with a start receipt.

Run the following against the latest accepted private canonical file. The output paths are distinct, private staging files.

```sh
node scripts/record-worker-events.mjs --snapshot Orbital.html --events receipts.json --output next/Orbital.html --state next/state.json
```

Use the Library version guard to replace the same canonical file, verify its contents, then immediately sync that accepted state to the owner service using the authenticated GET / If-Match PUT / readback protocol above. On conflict, materialize the latest canonical, reconcile with the service and replay the same receipts. A duplicate adds zero records. Preserve the durable workerEvents ledger on all later writes. When the publisher is unavailable retain the receipt privately for retry. This per-observation flush is independent of the regular end-of-cycle result sync and does not change the runner cadence.

An event for a new project opens a private project floor. The public projection remains limited to the original five projects. An open, visible Command page checks the feed every 15 seconds and checks again when returning to the page. Outside executions are visible only when an authorized producer reports them.

### Owner workspace views

The owner History reads dated Work results from `commandCenter.execution.workRuns` and the sector's recorded Work evidence. A result's `intendedOutcome` supplies the assignment brief. Preserve the executor list, source, tests, limitations and artifact URL on that same result. Leave unavailable fields empty. Never store verbatim prompts or conversation transcripts.

Needs Brian shows each pending project release from commandCenter.execution.releaseReviews and each genuine owner decision from sector assignments. Use one stable review ID per decision and set its true project. The numbered disclosures follow project order and retain the recorded order within each project. Station releases use the direct Build workflow. The list supports older snapshots containing grouped display records. A synthetic follow-up below illustrates the fields a producer may supply when an actual owner decision is needed.

```json
{
  "tag": "professional-101",
  "status": "waiting",
  "task": "Choose a title for the sample case study.",
  "ownerDecision": {
    "status": "open",
    "approver": "Brian",
    "question": "Which of the two reviewed titles should the draft use?",
    "reason": "The final cover depends on the selected title.",
    "nextAction": "The editor will apply the title to the private draft."
  },
  "acceptanceTest": "The title matches the owner's recorded selection."
}
```

Use an existing private `partialEvidenceUrl` or `ownerDecision.evidenceUrl` when available. Record the real decision through the established owner workflow. A resolved decision leaves Needs Brian. Waiting for observations, a source file or another person's approval remains a project dependency.
