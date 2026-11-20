# Needs Brian decisions

The owner can approve, deny, or edit a pending release review. Requests are authenticated, same-origin, conditional on the current ETag, and bound to the exact displayed review. Repeated identical requests return the original receipt. Visitors and service clients cannot submit owner decisions.

## Deny

`POST /api/release-response` with `decision: "deny"`, `reviewId`, and `expectedReview` (the JSON serialization of the displayed record) creates an immutable `commandCenter.execution.ownerReviewResponses` receipt. The original review becomes `denied` with `responseId`. It leaves the pending list, remains under Denied ideas, and must never be published or automatically reopened.

## Edit and request changes

The same endpoint accepts `decision: "revise"`, `editedOutput` (up to 20,000 characters), and `instructions` (up to 10,000 characters). At least one must contain text. The editor uses available `proposedOutput`, `output`, or `summary` text; it does not rewrite linked files. Draft edits remain in the dialog during feed refreshes and failed submissions. Cancel discards the unsent draft.

The receipt captures the original review plus both fields exactly. The original becomes `changes requested`. This is authorization for private revision work, not publication. The next unpaused hourly coordinator cycle must:

1. Merge the immutable receipt and original decision into canonical state before any write. Preserve `ownerReviewResponses` alongside approvals, skips, and workflow controls.
2. Deduplicate by receipt ID; inspect any existing revision claim or child review before retrying. Reserve the request with the normal conditional state write and record actual progress in the original review's `releaseProgress`.
3. Read the original source/evidence and apply the owner's edited output and instructions within the project's scope. Preserve the original artifact and decision. Test the actual revised result. Record concrete blockers rather than fabricating a result.
4. Append a new release review with a fresh stable ID, `revisesReviewId` set to the original review ID, `revisionOfResponseId` set to the receipt ID, and `status: "awaiting owner approval"`. Include the revised output, evidence, tests, limitations, exact action and destination. Do not copy any approval or response ID onto the new review.
5. Keep the original at `changes requested`; update its progress and optional `revisionReviewId` to point to the child. Needs Brian displays the new review and retains the owner's text under Requested revisions. Further edit cycles use another receipt and another child.

Service writes cannot discard responses, reopen denied originals, or introduce a pre-approved child. Each child requires a fresh owner approval before its external release. Paused workflows retain requests without executing them. The UI reports queued work as queued, never as completed or running without evidence.

Keep response contents and private artifacts out of the public source mirror. This file documents the protocol only.
