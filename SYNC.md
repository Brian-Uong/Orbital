# Station data

The desktop reads the newest valid station snapshot. Set ORBIT_STATE_FILE to the path of your own private JSON feed. A snapshot has updatedAt, commandCenter, agents, events and reports. See examples/station.json for the minimum format. To enable the hub conversation link, set commandCenter.coordinator.threadUrl in your private feed.

The hosted Worker uses an owner-authenticated read endpoint and an ETag-guarded update. Keep deployment bindings and credentials in your host configuration. Use synthetic data in public examples and tests.
