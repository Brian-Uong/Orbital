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
