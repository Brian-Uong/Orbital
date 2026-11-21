# Orbital

Orbital is an interactive station for coordinating project agents. Each reported worker has a room on a project floor. Select a room to see its latest activity. The owner workspace includes History, Roadmap and a numbered Needs Brian list. Open a decision to see its project, evidence and requested action. Visitors see the public sector summaries.

## Run locally

Use Node.js 22.16 or later. Run `npm start` and open the loopback address printed by the server. The example station has five idle sectors and uses bundled assets. No installation or API key is required.

## Build and test

- `npm test` exercises the state, authorization and local activity handlers.
- `npm run portable` creates a self-contained example at `dist/Orbital.html`, including the station renderer and background artwork.
- `npm run build` builds the Worker with example data. For your own deployment, supply your hosting manifest through `ORBIT_HOSTING_MANIFEST`.

The published owner workspace keeps its operational feed, coordinator link, and desktop exports private. This repository ships representative station data in `examples/station.json`.

## Releases

Station updates publish automatically. Each published version is mirrored here. The release commit records the Sites version and hosted source commit. Public examples and deployment templates stay independent of the owner workspace.

## How a project result reaches the owner

Orbital is the hourly coordinator. The signed-in Command view maps each project to its original conversations. A recorded folder name can appear before its destination has been verified. The coordinator claims one assignment, checks the destination, sends it to the original chat and records the accepted message. History credits a result after reading the reply and checking its evidence. Interactive delivery and unattended cloud delivery have separate receipts.

Before a project result reaches Needs Brian, the evaluator checks the exact revision against its original requirements. Failed checks return to the producing chat. A corrected artifact needs another check. A pass makes a revision eligible for owner review. Owner approval queues only the recorded action and destination. History distinguishes that approval, a remote commit or pull request, and verified production behavior.

Global Pause holds project work and releases. Individual project controls can hold one sector independently. Tested station maintenance follows the coordinator’s direct release path. The public view contains only coarse project status. Chat destinations, evaluation evidence, owner decisions and live records belong in private state.

The private illustrated tower has a coordinator on the top floor, one floor for each project, and an evaluator at ground level. Each original project conversation has its own office, including while idle or awaiting a verified link. Temporary execution history stays available separately. A returned revision goes back to its originating chat. A passed revision can enter owner review outside the building.
