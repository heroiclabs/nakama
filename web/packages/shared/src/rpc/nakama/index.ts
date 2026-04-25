import { callRpc, callHttpApi, type RpcOptions } from "../client";
import type {
  NakamaSession,
  NakamaUser,
  HealthStatus,
  ConsoleAccount,
  Leaderboard,
  LeaderboardRecord,
  LeaderboardRecordList,
  Tournament,
  TournamentList,
  TournamentRecordList,
  FriendList,
  NotificationList,
  UserGroupList,
  GroupUserList,
  ChannelMessageList,
  GroupList,
  NakamaGroup,
} from "../types";

export function authenticateDevice(
  deviceId: string,
  username?: string,
  opts?: Partial<RpcOptions>,
): Promise<NakamaSession> {
  const params = new URLSearchParams({ create: "true" });
  if (username) params.set("username", username);

  return callHttpApi<NakamaSession>(
    `/v2/account/authenticate/device?${params}`,
    {
      auth: opts?.auth ?? { type: "server-key" },
      method: "POST",
      body: { id: deviceId },
      signal: opts?.signal,
    },
  );
}

export function getAccount(opts: RpcOptions): Promise<ConsoleAccount> {
  return callHttpApi("/v2/account", opts);
}

export interface UpdateAccountRequest {
  username?: string;
  display_name?: string;
  avatar_url?: string;
  lang_tag?: string;
  location?: string;
  timezone?: string;
}

export function updateAccount(
  body: UpdateAccountRequest,
  opts: RpcOptions,
): Promise<void> {
  return callHttpApi("/v2/account", { ...opts, method: "PUT", body });
}

export function unlinkDevice(
  deviceId: string,
  opts: RpcOptions,
): Promise<void> {
  return callHttpApi("/v2/account/unlink/device", {
    ...opts,
    method: "POST",
    body: { id: deviceId },
  });
}

export function getHealthcheck(
  opts: RpcOptions,
): Promise<HealthStatus> {
  return callHttpApi("/healthcheck", opts);
}

export function listAccounts(
  optsOrFilter?: (RpcOptions & { limit?: number; cursor?: string; filter?: string }) | string,
  legacyLimit?: number,
  legacyOpts?: RpcOptions,
): Promise<any> {
  const opts: RpcOptions & { limit?: number; cursor?: string; filter?: string } =
    typeof optsOrFilter === "object" && optsOrFilter !== null && "auth" in optsOrFilter
      ? optsOrFilter
      : {
          ...(legacyOpts ?? { auth: { type: "server-key" } as const }),
          limit: legacyLimit,
          filter: typeof optsOrFilter === "string" ? optsOrFilter : undefined,
        };
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.filter) params.set("filter", opts.filter);
  return callHttpApi(`/v2/console/account?${params}`, opts);
}

export function getAccountById(
  userId: string,
  opts: RpcOptions,
): Promise<ConsoleAccount> {
  return callHttpApi(`/v2/console/account/${userId}`, opts);
}

export function banUser(userId: string, opts: RpcOptions) {
  return callHttpApi(`/v2/console/account/${userId}/ban`, {
    ...opts,
    method: "POST",
  });
}

export function unbanUser(userId: string, opts: RpcOptions) {
  return callHttpApi(`/v2/console/account/${userId}/unban`, {
    ...opts,
    method: "POST",
  });
}

export function deleteAccount(userId: string, opts: RpcOptions) {
  return callHttpApi(`/v2/console/account/${userId}`, {
    ...opts,
    method: "DELETE",
  });
}

export function listMatches(
  opts: RpcOptions & { limit?: number; label?: string },
): Promise<any> {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.label) params.set("label", opts.label);
  return callHttpApi(`/v2/match?${params}`, opts);
}

export function listStorageObjects(
  collection: string,
  optsOrUserId?: (RpcOptions & { userId?: string; limit?: number; cursor?: string }) | string,
  legacyCursor?: string,
  legacyLimit?: number,
  legacyOpts?: RpcOptions,
): Promise<any> {
  const opts: RpcOptions & { userId?: string; limit?: number; cursor?: string } =
    typeof optsOrUserId === "object" && optsOrUserId !== null && "auth" in optsOrUserId
      ? optsOrUserId
      : {
          ...(legacyOpts ?? { auth: { type: "server-key" } as const }),
          userId: typeof optsOrUserId === "string" ? optsOrUserId : undefined,
          cursor: legacyCursor,
          limit: legacyLimit,
        };
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.cursor) params.set("cursor", opts.cursor);
  const userPath = opts.userId ? `/${opts.userId}` : "";
  return callHttpApi(
    `/v2/storage/${collection}${userPath}?${params}`,
    opts,
  );
}

export function writeStorageObject(
  collection: string,
  key: string,
  value: unknown,
  opts: RpcOptions & { userId?: string; version?: string },
) {
  return callHttpApi("/v2/storage", {
    ...opts,
    method: "PUT",
    body: {
      objects: [
        {
          collection,
          key,
          value,
          permission_read: 2,
          permission_write: 1,
          version: opts.version ?? "*",
        },
      ],
    },
  });
}

/* ---- Leaderboards ---- */

export function listLeaderboardRecords(
  leaderboardId: string,
  opts: RpcOptions & {
    limit?: number;
    cursor?: string;
    ownerIds?: string[];
  },
): Promise<LeaderboardRecordList> {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.ownerIds?.length) {
    for (const id of opts.ownerIds) params.append("owner_ids", id);
  }
  return callHttpApi(`/v2/leaderboard/${leaderboardId}?${params}`, opts);
}

export function listLeaderboardRecordsAroundOwner(
  leaderboardId: string,
  ownerId: string,
  opts: RpcOptions & { limit?: number },
): Promise<LeaderboardRecordList> {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  return callHttpApi(
    `/v2/leaderboard/${leaderboardId}/owner/${ownerId}?${params}`,
    opts,
  );
}

export function writeLeaderboardRecord(
  leaderboardId: string,
  body: { score: number; subscore?: number; metadata?: Record<string, unknown> },
  opts: RpcOptions,
): Promise<LeaderboardRecord> {
  return callHttpApi(`/v2/leaderboard/${leaderboardId}`, {
    ...opts,
    method: "POST",
    body,
  });
}

export function deleteLeaderboardRecord(
  leaderboardId: string,
  opts: RpcOptions,
): Promise<void> {
  return callHttpApi(`/v2/leaderboard/${leaderboardId}`, {
    ...opts,
    method: "DELETE",
  });
}

/* ---- Tournaments ---- */

export function listTournaments(
  opts: RpcOptions & {
    limit?: number;
    cursor?: string;
    categoryStart?: number;
    categoryEnd?: number;
  },
): Promise<TournamentList> {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.categoryStart != null)
    params.set("category_start", String(opts.categoryStart));
  if (opts.categoryEnd != null)
    params.set("category_end", String(opts.categoryEnd));
  return callHttpApi(`/v2/tournament?${params}`, opts);
}

export function listTournamentRecords(
  tournamentId: string,
  opts: RpcOptions & {
    limit?: number;
    cursor?: string;
    ownerIds?: string[];
  },
): Promise<TournamentRecordList> {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.ownerIds?.length) {
    for (const id of opts.ownerIds) params.append("owner_ids", id);
  }
  return callHttpApi(`/v2/tournament/${tournamentId}?${params}`, opts);
}

export function listTournamentRecordsAroundOwner(
  tournamentId: string,
  ownerId: string,
  opts: RpcOptions & { limit?: number },
): Promise<TournamentRecordList> {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  return callHttpApi(
    `/v2/tournament/${tournamentId}/owner/${ownerId}?${params}`,
    opts,
  );
}

export function joinTournament(
  tournamentId: string,
  opts: RpcOptions,
) {
  return callHttpApi(`/v2/tournament/${tournamentId}/join`, {
    ...opts,
    method: "POST",
  });
}

export function writeTournamentRecord(
  tournamentId: string,
  body: { score: number; subscore?: number; metadata?: Record<string, unknown> },
  opts: RpcOptions,
): Promise<LeaderboardRecord> {
  return callHttpApi(`/v2/tournament/${tournamentId}`, {
    ...opts,
    method: "PUT",
    body,
  });
}

/* ---- Friends ---- */

export function listFriends(
  opts: RpcOptions & { limit?: number; state?: number; cursor?: string },
): Promise<FriendList> {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.state != null) params.set("state", String(opts.state));
  if (opts.cursor) params.set("cursor", opts.cursor);
  return callHttpApi(`/v2/friend?${params}`, opts);
}

export function addFriends(
  ids: string[],
  opts: RpcOptions,
): Promise<void> {
  const params = new URLSearchParams();
  ids.forEach((id) => params.append("ids", id));
  return callHttpApi(`/v2/friend?${params}`, { ...opts, method: "POST" });
}

export function addFriendsByUsername(
  usernames: string[],
  opts: RpcOptions,
): Promise<void> {
  const params = new URLSearchParams();
  usernames.forEach((u) => params.append("usernames", u));
  return callHttpApi(`/v2/friend?${params}`, { ...opts, method: "POST" });
}

export function deleteFriends(
  ids: string[],
  opts: RpcOptions,
): Promise<void> {
  const params = new URLSearchParams();
  ids.forEach((id) => params.append("ids", id));
  return callHttpApi(`/v2/friend?${params}`, { ...opts, method: "DELETE" });
}

export function blockFriends(
  ids: string[],
  opts: RpcOptions,
): Promise<void> {
  const params = new URLSearchParams();
  ids.forEach((id) => params.append("ids", id));
  return callHttpApi(`/v2/friend/block?${params}`, {
    ...opts,
    method: "POST",
  });
}

/* ---- Notifications ---- */

export function listNotifications(
  opts: RpcOptions & { limit?: number; cursor?: string },
): Promise<NotificationList> {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.cursor) params.set("cursor", opts.cursor);
  return callHttpApi(`/v2/notification?${params}`, opts);
}

export function deleteNotifications(
  ids: string[],
  opts: RpcOptions,
): Promise<void> {
  const params = new URLSearchParams();
  ids.forEach((id) => params.append("ids", id));
  return callHttpApi(`/v2/notification?${params}`, {
    ...opts,
    method: "DELETE",
  });
}

/* ---- Groups / Clans ---- */

export function listUserGroups(
  userId: string,
  opts: RpcOptions & { limit?: number; cursor?: string; state?: number },
): Promise<UserGroupList> {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.state !== undefined) params.set("state", String(opts.state));
  return callHttpApi(`/v2/user/${userId}/group?${params}`, opts);
}

export function listGroupUsers(
  groupId: string,
  opts: RpcOptions & { limit?: number; cursor?: string; state?: number },
): Promise<GroupUserList> {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.state !== undefined) params.set("state", String(opts.state));
  return callHttpApi(`/v2/group/${groupId}/user?${params}`, opts);
}

export function listGroups(
  opts: RpcOptions & { name?: string; limit?: number; cursor?: string; lang_tag?: string; open?: boolean },
): Promise<GroupList> {
  const params = new URLSearchParams();
  if (opts.name) params.set("name", opts.name);
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.lang_tag) params.set("lang_tag", opts.lang_tag);
  if (opts.open !== undefined) params.set("open", String(opts.open));
  return callHttpApi(`/v2/group?${params}`, opts);
}

export function createGroup(
  body: { name: string; description?: string; lang_tag?: string; avatar_url?: string; open?: boolean; max_count?: number },
  opts: RpcOptions,
): Promise<NakamaGroup> {
  return callHttpApi("/v2/group", { ...opts, method: "POST", body });
}

export function updateGroup(
  groupId: string,
  body: { name?: string; description?: string; lang_tag?: string; avatar_url?: string; open?: boolean },
  opts: RpcOptions,
): Promise<void> {
  return callHttpApi(`/v2/group/${groupId}`, { ...opts, method: "PUT", body });
}

export function deleteGroup(groupId: string, opts: RpcOptions): Promise<void> {
  return callHttpApi(`/v2/group/${groupId}`, { ...opts, method: "DELETE" });
}

export function joinGroup(groupId: string, opts: RpcOptions): Promise<void> {
  return callHttpApi(`/v2/group/${groupId}/join`, { ...opts, method: "POST" });
}

export function leaveGroup(groupId: string, opts: RpcOptions): Promise<void> {
  return callHttpApi(`/v2/group/${groupId}/leave`, { ...opts, method: "POST" });
}

export function addGroupUsers(
  groupId: string,
  userIds: string[],
  opts: RpcOptions,
): Promise<void> {
  const params = new URLSearchParams();
  userIds.forEach((id) => params.append("user_ids", id));
  return callHttpApi(`/v2/group/${groupId}/add?${params}`, { ...opts, method: "POST" });
}

export function kickGroupUsers(
  groupId: string,
  userIds: string[],
  opts: RpcOptions,
): Promise<void> {
  const params = new URLSearchParams();
  userIds.forEach((id) => params.append("user_ids", id));
  return callHttpApi(`/v2/group/${groupId}/kick?${params}`, { ...opts, method: "POST" });
}

export function promoteGroupUsers(
  groupId: string,
  userIds: string[],
  opts: RpcOptions,
): Promise<void> {
  const params = new URLSearchParams();
  userIds.forEach((id) => params.append("user_ids", id));
  return callHttpApi(`/v2/group/${groupId}/promote?${params}`, { ...opts, method: "POST" });
}

export function demoteGroupUsers(
  groupId: string,
  userIds: string[],
  opts: RpcOptions,
): Promise<void> {
  const params = new URLSearchParams();
  userIds.forEach((id) => params.append("user_ids", id));
  return callHttpApi(`/v2/group/${groupId}/demote?${params}`, { ...opts, method: "POST" });
}

export function banGroupUsers(
  groupId: string,
  userIds: string[],
  opts: RpcOptions,
): Promise<void> {
  const params = new URLSearchParams();
  userIds.forEach((id) => params.append("user_ids", id));
  return callHttpApi(`/v2/group/${groupId}/ban?${params}`, { ...opts, method: "POST" });
}

/* ---- Chat / Channel Messages ---- */

export function listChannelMessages(
  channelId: string,
  opts: RpcOptions & { limit?: number; forward?: boolean; cursor?: string },
): Promise<ChannelMessageList> {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.forward !== undefined) params.set("forward", String(opts.forward));
  if (opts.cursor) params.set("cursor", opts.cursor);
  return callHttpApi(`/v2/channel/${channelId}?${params}`, opts);
}

/* ---- Generic RPC ---- */

export function callCustomRpc<P = Record<string, unknown>, R = unknown>(
  rpcId: string,
  payload: P,
  opts: RpcOptions,
): Promise<R> {
  return callRpc<P, R>(rpcId, payload, opts);
}
