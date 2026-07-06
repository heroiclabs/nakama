// group_links.ts — shareable group invite codes (doc §7.3, §E.2; Q-05 —
// flagged the highest-K-factor item in the quick-win backlog).
//
// RPCs:
//   ivx_social_group_invite_link   — owner/admin mints a 6-char code
//   ivx_social_group_join_by_code  — anyone with the code joins directly
//
// STORAGE
//   ivx_groups_invite_codes / {CODE}   (system-owned, server-only perms)
//     { groupId, gameId, createdBy, createdAt, expiresAt|null,
//       maxUses|null, useCount, revoked }
//
// DESIGN NOTES
//   - Codes are 6 chars from an unambiguous alphabet (no 0/O/1/I/L) →
//     ~887M combinations; collision handled by retry-on-existing.
//   - Join uses nk.groupUsersAdd (server authority) — an invite code IS the
//     authorization, so private/invite-only groups are joined directly
//     rather than creating a state-3 join request.
//   - deepLink uses the web fallback domain (quizverse.world — the REAL
//     production domain per web/lib/site.ts; NOT quizverse.app, see the
//     Phantom guide Gap 11) plus the custom scheme for installed clients.
//   - shareText included per §E.2 so Unity can hand it straight to the
//     native Share Sheet.
//   - Used/expired codes are swept by ivx_social_maintenance_tick.

namespace SocialGroupLinks {

  var CODES_COLLECTION   = "ivx_groups_invite_codes";
  var SYSTEM_USER        = "00000000-0000-0000-0000-000000000000";
  var CODE_ALPHABET      = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
  var CODE_LEN           = 6;
  var MAX_MINT_RETRIES   = 5;
  var MAX_EXPIRES_HOURS  = 24 * 30; // 30 days cap
  var WEB_LINK_BASE      = "https://quizverse.world/join/group/";
  var SCHEME_LINK_BASE   = "quizverse://group/join/";

  // Nakama group member states.
  var ROLE_SUPERADMIN = 0;
  var ROLE_ADMIN      = 1;

  function mintCode(nk: nkruntime.Nakama): string {
    var code = "";
    for (var i = 0; i < CODE_LEN; i++) {
      code += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
    }
    return code;
  }

  function readCode(nk: nkruntime.Nakama, code: string): any {
    try {
      var rows = nk.storageRead([{ collection: CODES_COLLECTION, key: code, userId: SYSTEM_USER }]);
      if (rows && rows.length > 0 && rows[0] && rows[0].value) {
        return { value: rows[0].value, version: rows[0].version || "" };
      }
    } catch (_) {}
    return null;
  }

  function callerRoleInGroup(nk: nkruntime.Nakama, userId: string, groupId: string): number {
    try {
      var res = nk.userGroupsList(userId, 100, undefined as any, undefined as any);
      var list: any[] = (res && res.userGroups) ? res.userGroups : [];
      for (var i = 0; i < list.length; i++) {
        var ug: any = list[i];
        if (ug && ug.group && ug.group.id === groupId && typeof ug.state === "number") {
          return ug.state;
        }
      }
    } catch (_) {}
    return -1;
  }

  // ── RPC: ivx_social_group_invite_link ─────────────────────────────────────
  // Payload: { groupId, expiresInHours?: number, maxUses?: number }
  function rpcInviteLink(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload) || {};
      var groupId = data.groupId;
      if (!groupId || typeof groupId !== "string") {
        return RpcHelpers.errorResponse("groupId is required");
      }

      // Auth: only owner (superadmin) or admin may mint share links.
      var role = callerRoleInGroup(nk, userId, groupId);
      if (role !== ROLE_SUPERADMIN && role !== ROLE_ADMIN) {
        return RpcHelpers.errorResponse("Only the group owner or an admin can create invite links");
      }

      // Group must exist; pull name + gameId for the link payload.
      var groups = nk.groupsGetId([groupId]);
      if (!groups || groups.length === 0) {
        return RpcHelpers.errorResponse("Group not found");
      }
      var group: any = groups[0];
      var meta: any = {};
      try { meta = (typeof group.metadata === "string") ? JSON.parse(group.metadata || "{}") : (group.metadata || {}); } catch (_) {}
      var gameId = meta.gameId || "quizverse";

      var expiresAt: string | null = null;
      if (typeof data.expiresInHours === "number" && data.expiresInHours > 0) {
        var hours = Math.min(data.expiresInHours, MAX_EXPIRES_HOURS);
        expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
      }
      var maxUses: number | null = null;
      if (typeof data.maxUses === "number" && data.maxUses > 0) {
        maxUses = Math.min(Math.floor(data.maxUses), 10000);
      }

      // Mint a unique code (retry on the astronomically-unlikely collision).
      var code = "";
      var minted = false;
      for (var attempt = 0; attempt < MAX_MINT_RETRIES && !minted; attempt++) {
        code = mintCode(nk);
        if (readCode(nk, code) === null) minted = true;
      }
      if (!minted) {
        return RpcHelpers.errorResponse("Could not mint a unique invite code — try again");
      }

      nk.storageWrite([{
        collection: CODES_COLLECTION, key: code, userId: SYSTEM_USER,
        value: {
          groupId:   groupId,
          gameId:    gameId,
          groupName: group.name || "",
          createdBy: userId,
          createdAt: new Date().toISOString(),
          expiresAt: expiresAt,
          maxUses:   maxUses,
          useCount:  0,
          revoked:   false
        },
        permissionRead: 0, permissionWrite: 0
      }]);

      var deepLink = WEB_LINK_BASE + code;
      return RpcHelpers.successResponse({
        inviteCode: code,
        deepLink:   deepLink,
        schemeLink: SCHEME_LINK_BASE + code,
        expiresAt:  expiresAt,
        maxUses:    maxUses,
        shareText:  "Join my QuizVerse group \"" + (group.name || "my group") + "\"! 🎯 " + deepLink
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to create invite link");
    }
  }

  // ── RPC: ivx_social_group_join_by_code ────────────────────────────────────
  // Payload: { inviteCode, gameId? }
  function rpcJoinByCode(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload) || {};
      var rawCode = data.inviteCode;
      if (!rawCode || typeof rawCode !== "string") {
        return RpcHelpers.errorResponse("inviteCode is required");
      }
      var code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, CODE_LEN);

      var found = readCode(nk, code);
      if (!found) {
        return RpcHelpers.errorResponse("Invalid or expired invite code");
      }
      var row: any = found.value;

      if (row.revoked === true) {
        return RpcHelpers.errorResponse("This invite link has been revoked");
      }
      if (row.expiresAt && Date.parse(row.expiresAt) < Date.now()) {
        return RpcHelpers.errorResponse("This invite link has expired");
      }
      if (typeof row.maxUses === "number" && row.maxUses > 0 && row.useCount >= row.maxUses) {
        return RpcHelpers.errorResponse("This invite link has reached its usage limit");
      }
      if (data.gameId && typeof data.gameId === "string" &&
          row.gameId && data.gameId.toLowerCase() !== String(row.gameId).toLowerCase()) {
        return RpcHelpers.errorResponse("This invite is for a different game");
      }

      // Group must still exist and have room.
      var groups = nk.groupsGetId([row.groupId]);
      if (!groups || groups.length === 0) {
        return RpcHelpers.errorResponse("This group no longer exists");
      }
      var group: any = groups[0];
      if (typeof group.edgeCount === "number" && typeof group.maxCount === "number" &&
          group.maxCount > 0 && group.edgeCount >= group.maxCount) {
        return RpcHelpers.errorResponse("This group is full");
      }

      // Already a member? Idempotent success.
      var existingRole = callerRoleInGroup(nk, userId, row.groupId);
      var alreadyMember = (existingRole >= ROLE_SUPERADMIN && existingRole <= 2);
      if (!alreadyMember) {
        // Server-authority add — the code IS the authorization, so this works
        // for private/invite-only groups without a join-request round-trip.
        nk.groupUsersAdd(row.groupId, [userId]);

        // Bump useCount (version-checked, best-effort — a lost increment is
        // an acceptable, conservative failure: the code allows one extra use).
        try {
          row.useCount = (typeof row.useCount === "number" ? row.useCount : 0) + 1;
          row.lastUsedAt = new Date().toISOString();
          nk.storageWrite([{
            collection: CODES_COLLECTION, key: code, userId: SYSTEM_USER,
            value: row, version: found.version,
            permissionRead: 0, permissionWrite: 0
          }]);
        } catch (_) { /* non-fatal */ }

        // ML-004 fix: notify the group owner someone joined via their link.
        try {
          var joinerName = ctx.username || userId;
          try {
            var users = nk.usersGetId([userId]);
            if (users && users.length > 0 && users[0]) {
              joinerName = users[0].displayName || users[0].username || joinerName;
            }
          } catch (_) {}
          nk.notificationsSend([{
            userId:  row.createdBy,
            subject: "group_member_joined",
            content: {
              type: "group_member_joined", code: 22,
              groupId: row.groupId, groupName: group.name || "",
              joinedUserId: userId, joinedName: joinerName,
              viaInviteCode: code
            },
            code: 22, senderId: userId, persistent: true
          }]);
        } catch (notifErr: any) {
          logger.warn("[GroupLinks] owner notification failed (non-fatal): " + (notifErr && notifErr.message));
        }
      }

      return RpcHelpers.successResponse({
        joined:        !alreadyMember,
        alreadyMember: alreadyMember,
        group: {
          id:          row.groupId,
          name:        group.name || "",
          description: group.description || "",
          avatarUrl:   group.avatarUrl || "",
          memberCount: group.edgeCount || 0,
          maxCount:    group.maxCount || 0,
          gameId:      row.gameId || ""
        }
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to join by code");
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("ivx_social_group_invite_link", rpcInviteLink);
    initializer.registerRpc("ivx_social_group_join_by_code", rpcJoinByCode);
  }
}
