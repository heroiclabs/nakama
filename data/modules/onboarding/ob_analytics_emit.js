/**
 * Server-side ob_* analytics for Unity onboarding hooks (D1/D7, welcome bonus, streak shield).
 * Writes to qv_onboarding_events — same lake as web onboarding_events_batch.
 */
function obAnalyticsEmitEvent(nk, nakamaUserId, eventName, data) {
    if (!nk || !nakamaUserId || !eventName) return;
    var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
    var COL = "qv_onboarding_events";
    var ts = Date.now();
    var inv = "" + (100000000000000 - ts);
    while (inv.length < 14) inv = "0" + inv;
    var safe = (eventName || "x").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
    var key = "ev_0" + inv + "_" + safe;
    var record = {
        identityId: nakamaUserId,
        userId: nakamaUserId,
        nakamaUserId: nakamaUserId,
        name: eventName,
        timestamp: ts,
        screen: "",
        sessionId: "server",
        dwellMs: 0,
        data: data || {},
        userSnapshot: {},
        date: new Date(ts).toISOString().slice(0, 10)
    };
    try {
        nk.storageWrite([
            {
                collection: COL,
                key: key,
                userId: SYSTEM_USER_ID,
                value: record,
                permissionRead: 0,
                permissionWrite: 0
            },
            {
                collection: COL,
                key: key,
                userId: nakamaUserId,
                value: record,
                permissionRead: 2,
                permissionWrite: 0
            }
        ]);
    } catch (e) {
        /* non-fatal */
    }
}
