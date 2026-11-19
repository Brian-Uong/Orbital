# Orbital

Orbital is an interactive station for coordinating project agents. Select a room to inspect its assignment, or open the central hub to see the full roster. Directory and Briefings share the same city backdrop.

## Run locally

Use Node.js 22.16 or later. Run `npm start` and open the loopback address printed by the server. The example station has five idle sectors and uses bundled assets. No installation or API key is required.

## Build and test

- `npm test` exercises the state, authorization and local activity handlers.
- `npm run portable` creates a self-contained example at `dist/Orbital.html`, including the station renderer and background artwork.
- `npm run build` builds the Worker with example data. For your own deployment, supply your hosting manifest through `ORBIT_HOSTING_MANIFEST`.

The published owner workspace keeps its operational feed, coordinator link, and desktop exports private. This repository ships representative station data in `examples/station.json`.
