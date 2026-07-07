// group_limits.ts — server-side cap on concurrent group memberships.
//
// The Unity client blocks joins past the limit for instant feedback
// (GroupsNakamaService.MaxJoinedGroups), but client checks are bypassable —
// this beforeJoinGroup hook is the authoritative gate. Keep the two constants
// in sync when changing the limit.
//
// POSTBUILD CONTRACT: hooks register via registerHooks() called from main.ts
// InitModule with a REAL initializer — never from a register() body, which
// postbuild.js auto-invokes at IIFE scope where initializer is undefined
// (that exact bug shipped 2026-07 in SocialMaintenance; see maintenance.ts).
namespace SocialGroupLimits {

  export const MAX_JOINED_GROUPS = 10;

  export function registerHooks(initializer: nkruntime.Initializer): void {
    try {
      initializer.registerBeforeJoinGroup(beforeJoinGroupLimit);
    } catch (e: any) {
      // Older runtimes without the hook: limit is then enforced client-side
      // only — degraded but not broken.
    }
  }

  function beforeJoinGroupLimit(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    data: any
  ): any {
    var userId = ctx.userId;
    if (!userId) return data;

    var activeCount = 0;
    try {
      // States: 0 superadmin, 1 admin, 2 member, 3 join-request-pending.
      // Pending requests don't count against the cap — they may be declined.
      var res: any = nk.userGroupsList(userId, 100);
      var userGroups = (res && res.userGroups) || [];
      for (var i = 0; i < userGroups.length; i++) {
        var ug = userGroups[i];
        if (ug && typeof ug.state === "number" && ug.state <= 2) activeCount++;
      }
    } catch (e: any) {
      // Fail-open: a listing error must never block legitimate joins.
      logger.warn("[SocialGroupLimits] userGroupsList failed for " + userId +
        ": " + (e && e.message || e) + " — allowing join.");
      return data;
    }

    if (activeCount >= MAX_JOINED_GROUPS) {
      logger.info("[SocialGroupLimits] join blocked for " + userId +
        ": already in " + activeCount + " groups (max " + MAX_JOINED_GROUPS + ")");
      throw new Error("You can join up to " + MAX_JOINED_GROUPS +
        " groups. Leave one first.");
    }

    return data;
  }
}
