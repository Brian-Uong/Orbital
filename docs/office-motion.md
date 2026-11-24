# Responsive offices and activity motion

Each floor distributes its width between its rooms. Rooms wrap on narrow screens and the final row fills the remaining width. Every floor shares the same viewport-responsive room height and furniture scale, independent of its occupant count. A full-width architectural layer fills the bay; the bed, person and desk keep their proportions. Wide rooms add a lounge with a sofa, shelving, coffee table and plant instead of enlarging their occupant.

Working rooms animate two alternating hands over a visible keyboard in short typing bursts followed by a pause. Subtle key highlights, head glances, leg shifts, occasional posture changes and screen opacity reinforce the work cycle. Idle or completed occupants rest in bed, with slow breathing, a gentle head turn and a drifting sleep mark. Unknown, stale or blocked activity stays neutral at the desk. These are illustrations of recorded state, not evidence of execution.

Conversation rooms use the latest attributed execution signal in `commandCenter.execution.projectConversationReceipts`. A signal requires the matching verified chat URL, exact thread title, matching project, a message ID and a valid observed time. `started`, `working` and `progress` animate only for five minutes (or an earlier explicit expiresAt). `sent` and `assigned` alone never mean execution. Later idle/completed/verified/reply/result signals stop work animation. Expired or future work signals show Activity unconfirmed. Existing expiry timers stop motion even without another state update.

The SVG subtree persists across status changes. Animations use transforms and opacity, with no frame-by-frame JavaScript loop or animated blur. IntersectionObserver pauses off-screen rooms. Hidden tabs, Pause desks, Still sky and reduced-motion preferences also stop animation. Observers and visibility listeners are cleaned up on destruction. Fresh activity should be recorded at genuine observed starts/progress/completion; do not fabricate heartbeats or add a polling schedule for animation.


