export interface LedgerObject
{
  id: string,
  changeset: string,
  metadata: string,
  create_time: string,
  update_time: string
};

export interface FriendObject
{
  user: UserObject,
  state?: string
};

export interface GroupObject
{
  id: string,
  name?: string,
  update_time?: string,
};

export interface UserDeleteFriendRequest
{
  id?: string,
  friendId?: string
};

export interface UserDeleteGroupRequest
{
  id?: string,
  groupId?: string
};

export interface UserGroupObject
{
  group: GroupObject,
  state?: string,
};

export interface UserObjectRequest
{
  id?: string,
  recorded?: boolean,
  filter?: string,
  banned?: boolean,
  tombstones?: boolean
};

export interface UserUnlinkDeviceRequest
{
  id?: string,
  device_id?: string
};

export interface LedgerObjectRequest
{
  walletId?: string,
  id?: string
};

export interface UserObject
{
  id: string,
  username?: string,
  display_name?: string,
  avatar_url?: string,
  lang_tag?: string,
  location?: string,
  timezone?: string,
  metadata?: string,
  facebook_id?: string,
  facebook_instant_game_id?: string,
  google_id?: string,
  gamecenter_id?: string,
  steam_id?: string,
  edge_count?: number,
  create_time?: string,
  update_time?: string
};

export interface UsersObjectRequest
{
  filter?: string,
  banned?: boolean,
  tombstones?: boolean
};

export interface UsersObject
{
  users: UserObject[],
  total_count: number
};

export interface AccountObject
{
  user: UserObject,
  wallet?: string,
  devices?: any[],
  custom_id?: string,
  email?: string,
  password?: string,
  verify_time?: string
};

export interface ExportObject
{
  account: AccountObject,
  disable_time?: string,
  leaderboard_records?: any[],
  wallet_ledgers?: LedgerObject[]
};

export enum UserActionTypes
{
  FETCH_MANY_REQUEST = '@@user/FETCH_MANY_REQUEST',
  FETCH_MANY_SUCCESS = '@@user/FETCH_MANY_SUCCESS',
  FETCH_MANY_ERROR = '@@user/FETCH_MANY_ERROR',
  DELETE_MANY_REQUEST = '@@user/DELETE_MANY_REQUEST',
  DELETE_MANY_SUCCESS = '@@user/DELETE_MANY_SUCCESS',
  DELETE_MANY_ERROR = '@@user/DELETE_MANY_ERROR',
  FETCH_REQUEST = '@@user/FETCH_REQUEST',
  FETCH_SUCCESS = '@@user/FETCH_SUCCESS',
  FETCH_ERROR = '@@user/FETCH_ERROR',
  EXPORT_REQUEST = '@@user/EXPORT_REQUEST',
  EXPORT_SUCCESS = '@@user/EXPORT_SUCCESS',
  EXPORT_ERROR = '@@user/EXPORT_ERROR',
  UPDATE_REQUEST = '@@user/UPDATE_REQUEST',
  UPDATE_SUCCESS = '@@user/UPDATE_SUCCESS',
  UPDATE_ERROR = '@@user/UPDATE_ERROR',
  DELETE_REQUEST = '@@user/DELETE_REQUEST',
  DELETE_SUCCESS = '@@user/DELETE_SUCCESS',
  DELETE_ERROR = '@@user/DELETE_ERROR',
  BAN_REQUEST = '@@user/BAN_REQUEST',
  BAN_SUCCESS = '@@user/BAN_SUCCESS',
  BAN_ERROR = '@@user/BAN_ERROR',
  UNBAN_REQUEST = '@@user/UNBAN_REQUEST',
  UNBAN_SUCCESS = '@@user/UNBAN_SUCCESS',
  UNBAN_ERROR = '@@user/UNBAN_ERROR',
  FETCH_MANY_LEDGER_REQUEST = '@@user/FETCH_MANY_LEDGER_REQUEST',
  FETCH_MANY_LEDGER_SUCCESS = '@@user/FETCH_MANY_LEDGER_SUCCESS',
  FETCH_MANY_LEDGER_ERROR = '@@user/FETCH_MANY_LEDGER_ERROR',
  DELETE_LEDGER_REQUEST = '@@user/DELETE_LEDGER_REQUEST',
  DELETE_LEDGER_SUCCESS = '@@user/DELETE_LEDGER_SUCCESS',
  DELETE_LEDGER_ERROR = '@@user/DELETE_LEDGER_ERROR',
  FETCH_MANY_FRIEND_REQUEST = '@@user/FETCH_MANY_FRIEND_REQUEST',
  FETCH_MANY_FRIEND_SUCCESS = '@@user/FETCH_MANY_FRIEND_SUCCESS',
  FETCH_MANY_FRIEND_ERROR = '@@user/FETCH_MANY_FRIEND_ERROR',
  DELETE_FRIEND_REQUEST = '@@user/DELETE_FRIEND_REQUEST',
  DELETE_FRIEND_SUCCESS = '@@user/DELETE_FRIEND_SUCCESS',
  DELETE_FRIEND_ERROR = '@@user/DELETE_FRIEND_ERROR',
  FETCH_MANY_GROUP_REQUEST = '@@user/FETCH_MANY_GROUP_REQUEST',
  FETCH_MANY_GROUP_SUCCESS = '@@user/FETCH_MANY_GROUP_SUCCESS',
  FETCH_MANY_GROUP_ERROR = '@@user/FETCH_MANY_GROUP_ERROR',
  DELETE_GROUP_REQUEST = '@@user/DELETE_GROUP_REQUEST',
  DELETE_GROUP_SUCCESS = '@@user/DELETE_GROUP_SUCCESS',
  DELETE_GROUP_ERROR = '@@user/DELETE_GROUP_ERROR',
  UNLINK_STEAM_REQUEST = '@@user/UNLINK_STEAM_REQUEST',
  UNLINK_STEAM_SUCCESS = '@@user/UNLINK_STEAM_SUCCESS',
  UNLINK_STEAM_ERROR = '@@user/UNLINK_STEAM_ERROR',
  UNLINK_GOOGLE_REQUEST = '@@user/UNLINK_GOOGLE_REQUEST',
  UNLINK_GOOGLE_SUCCESS = '@@user/UNLINK_GOOGLE_SUCCESS',
  UNLINK_GOOGLE_ERROR = '@@user/UNLINK_GOOGLE_ERROR',
  UNLINK_GAMECENTER_REQUEST = '@@user/UNLINK_GAMECENTER_REQUEST',
  UNLINK_GAMECENTER_SUCCESS = '@@user/UNLINK_GAMECENTER_SUCCESS',
  UNLINK_GAMECENTER_ERROR = '@@user/UNLINK_GAMECENTER_ERROR',
  UNLINK_FACEBOOK_REQUEST = '@@user/UNLINK_FACEBOOK_REQUEST',
  UNLINK_FACEBOOK_SUCCESS = '@@user/UNLINK_FACEBOOK_SUCCESS',
  UNLINK_FACEBOOK_ERROR = '@@user/UNLINK_FACEBOOK_ERROR',
  UNLINK_FACEBOOK_INSTANT_GAME_REQUEST = '@@user/UNLINK_FACEBOOK_INSTANT_GAME_REQUEST',
  UNLINK_FACEBOOK_INSTANT_GAME_SUCCESS = '@@user/UNLINK_FACEBOOK_INSTANT_GAME_SUCCESS',
  UNLINK_FACEBOOK_INSTANT_GAME_ERROR = '@@user/UNLINK_FACEBOOK_INSTANT_GAME_ERROR',
  UNLINK_EMAIL_REQUEST = '@@user/UNLINK_EMAIL_REQUEST',
  UNLINK_EMAIL_SUCCESS = '@@user/UNLINK_EMAIL_SUCCESS',
  UNLINK_EMAIL_ERROR = '@@user/UNLINK_EMAIL_ERROR',
  UNLINK_DEVICE_REQUEST = '@@user/UNLINK_DEVICE_REQUEST',
  UNLINK_DEVICE_SUCCESS = '@@user/UNLINK_DEVICE_SUCCESS',
  UNLINK_DEVICE_ERROR = '@@user/UNLINK_DEVICE_ERROR',
  UNLINK_CUSTOM_REQUEST = '@@user/UNLINK_CUSTOM_REQUEST',
  UNLINK_CUSTOM_SUCCESS = '@@user/UNLINK_CUSTOM_SUCCESS',
  UNLINK_CUSTOM_ERROR = '@@user/UNLINK_CUSTOM_ERROR'
};

export interface UsersState
{
  readonly loading: boolean,
  readonly data: UsersObject,
  readonly errors?: string
};

export interface UserState
{
  readonly loading: boolean,
  readonly updated: boolean,
  readonly data: ExportObject,
  readonly account: ExportObject,
  readonly ledgers: LedgerObject[],
  readonly friends: FriendObject[],
  readonly groups: UserGroupObject[],
  readonly errors?: string
};
