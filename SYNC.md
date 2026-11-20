# Station data

The desktop reads the newest valid station snapshot. Set ORBIT_STATE_FILE to the path of your own private JSON feed. A snapshot has updatedAt, commandCenter, agents, events and reports. See examples/station.json for the minimum format. To enable the hub conversation link, set commandCenter.coordinator.threadUrl in your private feed.

The hosted Worker uses an owner-authenticated read endpoint and an ETag-guarded update. Keep deployment bindings and credentials in your host configuration. Use synthetic data in public examples and tests.


## Public viewing and owner access

Visitors can read the five sector names and coarse statuses. The public response omits tasks, private evidence, conversation routes, activity and briefing contents. Sites supplies authenticated browser identity. Configure ORBIT_OWNER_EMAIL as a server-only secret using the verified owner email from the Site access policy. An empty setting grants no browser owner privileges. Top-level Owner sign in opens the platform sign-in flow.

Owner updates require a same-origin browser request. The authorized sync service retains its existing writer key. Both use If-Match for changes to the project feed. Before state sync, confirm the exact HTTPS origin, owner role and the owner's selected public audience. Verify the sanitized public response independently of the authenticated readback.

## Station releases

Orbital Build publishes tested station updates directly, then mirrors their public source here. Each release commit identifies its Sites version and source SHA. Needs Brian lists project decisions by their recorded owner and keeps each review independently expandable.
