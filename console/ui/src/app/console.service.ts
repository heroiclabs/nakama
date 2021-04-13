// tslint:disable
/* Code generated automatically DO NOT EDIT. */
import { Injectable, Optional } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

const DEFAULT_HOST = 'http://127.0.0.1:7120';
const DEFAULT_TIMEOUT_MS = 5000;

export class ConfigParams {
  host: string
  timeoutMs: number
}

@Injectable({providedIn: 'root'})
export class ConsoleService {
  private readonly config;

  constructor(private httpClient: HttpClient, @Optional() config: ConfigParams) {
    const defaultConfig: ConfigParams = {
      host: DEFAULT_HOST,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    };
    this.config = config || defaultConfig;
  }

  public addUser(auth_token: string, body: AddUserRequest): Observable<any> {
    const urlPath = `/v2/console/user`;
    let params = new HttpParams();
    return this.httpClient.post(this.config.host + urlPath, body, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public authenticate(body: AuthenticateRequest): Observable<ConsoleSession> {
    const urlPath = `/v2/console/authenticate`;
    let params = new HttpParams();
    return this.httpClient.post<ConsoleSession>(this.config.host + urlPath, body, { params: params })
  }

  public banAccount(auth_token: string, id: string): Observable<any> {
    const urlPath = `/v2/console/account/${id}/ban`;
    let params = new HttpParams();
    return this.httpClient.post(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public callApiEndpoint(auth_token: string, method: string, body: CallApiEndpointRequest): Observable<CallApiEndpointResponse> {
    const urlPath = `/v2/console/api/endpoints/${method}`;
    let params = new HttpParams();
    return this.httpClient.post<CallApiEndpointResponse>(this.config.host + urlPath, body, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public callRpcEndpoint(auth_token: string, method: string, body: CallApiEndpointRequest): Observable<CallApiEndpointResponse> {
    const urlPath = `/v2/console/api/endpoints/rpc/${method}`;
    let params = new HttpParams();
    return this.httpClient.post<CallApiEndpointResponse>(this.config.host + urlPath, body, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public deleteAccount(auth_token: string, id: string, record_deletion: boolean): Observable<any> {
    const urlPath = `/v2/console/account/${id}`;
    let params = new HttpParams();
    if (record_deletion) {
      params = params.set('record_deletion', String(record_deletion));
    }
    return this.httpClient.delete(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public deleteAccounts(auth_token: string): Observable<any> {
    const urlPath = `/v2/console/account`;
    let params = new HttpParams();
    return this.httpClient.delete(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public deleteFriend(auth_token: string, id: string, friend_id: string): Observable<any> {
    const urlPath = `/v2/console/account/${id}/friend/${friend_id}`;
    let params = new HttpParams();
    return this.httpClient.delete(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public deleteGroupUser(auth_token: string, id: string, group_id: string): Observable<any> {
    const urlPath = `/v2/console/account/${id}/group/${group_id}`;
    let params = new HttpParams();
    return this.httpClient.delete(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public deleteLeaderboard(auth_token: string, id: string): Observable<any> {
    const urlPath = `/v2/console/leaderboard/${id}`;
    let params = new HttpParams();
    return this.httpClient.delete(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public deleteLeaderboardRecord(auth_token: string, id: string, owner_id: string): Observable<any> {
    const urlPath = `/v2/console/leaderboard/${id}/owner/${owner_id}`;
    let params = new HttpParams();
    return this.httpClient.delete(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public deleteStorage(auth_token: string): Observable<any> {
    const urlPath = `/v2/console/storage`;
    let params = new HttpParams();
    return this.httpClient.delete(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public deleteStorageObject(auth_token: string, collection: string, key: string, user_id: string, version: string): Observable<any> {
    const urlPath = `/v2/console/storage/${collection}/${key}/${user_id}`;
    let params = new HttpParams();
    if (version) {
      params = params.set('version', version);
    }
    return this.httpClient.delete(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public deleteUser(auth_token: string, username: string): Observable<any> {
    const urlPath = `/v2/console/user`;
    let params = new HttpParams();
    if (username) {
      params = params.set('username', username);
    }
    return this.httpClient.delete(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public deleteWalletLedger(auth_token: string, id: string, wallet_id: string): Observable<any> {
    const urlPath = `/v2/console/account/${id}/wallet/${wallet_id}`;
    let params = new HttpParams();
    return this.httpClient.delete(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public exportAccount(auth_token: string, id: string): Observable<AccountExport> {
    const urlPath = `/v2/console/account/${id}/export`;
    let params = new HttpParams();
    return this.httpClient.get<AccountExport>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public getAccount(auth_token: string, id: string): Observable<Account> {
    const urlPath = `/v2/console/account/${id}`;
    let params = new HttpParams();
    return this.httpClient.get<Account>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public getConfig(auth_token: string): Observable<Config> {
    const urlPath = `/v2/console/config`;
    let params = new HttpParams();
    return this.httpClient.get<Config>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public getFriends(auth_token: string, id: string): Observable<ApiFriendList> {
    const urlPath = `/v2/console/account/${id}/friend`;
    let params = new HttpParams();
    return this.httpClient.get<ApiFriendList>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public getGroups(auth_token: string, id: string): Observable<ApiUserGroupList> {
    const urlPath = `/v2/console/account/${id}/group`;
    let params = new HttpParams();
    return this.httpClient.get<ApiUserGroupList>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public getLeaderboard(auth_token: string, id: string): Observable<Leaderboard> {
    const urlPath = `/v2/console/leaderboard/${id}`;
    let params = new HttpParams();
    return this.httpClient.get<Leaderboard>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public getMatchState(auth_token: string, id: string): Observable<MatchState> {
    const urlPath = `/v2/console/match/${id}/state`;
    let params = new HttpParams();
    return this.httpClient.get<MatchState>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public getRuntime(auth_token: string): Observable<RuntimeInfo> {
    const urlPath = `/v2/console/runtime`;
    let params = new HttpParams();
    return this.httpClient.get<RuntimeInfo>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public getStatus(auth_token: string): Observable<StatusList> {
    const urlPath = `/v2/console/status`;
    let params = new HttpParams();
    return this.httpClient.get<StatusList>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public getStorage(auth_token: string, collection: string, key: string, user_id: string): Observable<ApiStorageObject> {
    const urlPath = `/v2/console/storage/${collection}/${key}/${user_id}`;
    let params = new HttpParams();
    return this.httpClient.get<ApiStorageObject>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public getWalletLedger(auth_token: string, id: string): Observable<WalletLedgerList> {
    const urlPath = `/v2/console/account/${id}/wallet`;
    let params = new HttpParams();
    return this.httpClient.get<WalletLedgerList>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public listAccounts(auth_token: string, filter: string, tombstones: boolean, cursor: string): Observable<AccountList> {
    const urlPath = `/v2/console/account`;
    let params = new HttpParams();
    if (filter) {
      params = params.set('filter', filter);
    }
    if (tombstones) {
      params = params.set('tombstones', String(tombstones));
    }
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    return this.httpClient.get<AccountList>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public listApiEndpoints(auth_token: string): Observable<ApiEndpointList> {
    const urlPath = `/v2/console/api/endpoints`;
    let params = new HttpParams();
    return this.httpClient.get<ApiEndpointList>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public listLeaderboardRecords(auth_token: string, leaderboard_id: string, owner_ids: string[], limit: number, cursor: string, expiry: string): Observable<ApiLeaderboardRecordList> {
    const urlPath = `/v2/console/leaderboard/${leaderboard_id}/records`;
    let params = new HttpParams();
    if (owner_ids) {
      owner_ids.forEach(e => params = params.append('owner_ids', String(e)))
    }
    if (limit) {
      params = params.set('limit', String(limit));
    }
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    if (expiry) {
      params = params.set('expiry', expiry);
    }
    return this.httpClient.get<ApiLeaderboardRecordList>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public listLeaderboards(auth_token: string): Observable<LeaderboardList> {
    const urlPath = `/v2/console/leaderboard`;
    let params = new HttpParams();
    return this.httpClient.get<LeaderboardList>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public listMatches(auth_token: string, limit: number, authoritative: boolean, label: string, min_size: number, max_size: number, query: string): Observable<ApiMatchList> {
    const urlPath = `/v2/console/match`;
    let params = new HttpParams();
    if (limit) {
      params = params.set('limit', String(limit));
    }
    if (authoritative) {
      params = params.set('authoritative', String(authoritative));
    }
    if (label) {
      params = params.set('label', label);
    }
    if (min_size) {
      params = params.set('min_size', String(min_size));
    }
    if (max_size) {
      params = params.set('max_size', String(max_size));
    }
    if (query) {
      params = params.set('query', query);
    }
    return this.httpClient.get<ApiMatchList>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public listPurchases(auth_token: string, user_id: string, limit: number, cursor: string): Observable<ApiPurchaseList> {
    const urlPath = `/v2/console/purchase`;
    let params = new HttpParams();
    if (user_id) {
      params = params.set('user_id', user_id);
    }
    if (limit) {
      params = params.set('limit', String(limit));
    }
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    return this.httpClient.get<ApiPurchaseList>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public listStorage(auth_token: string, user_id: string, key: string, collection: string, cursor: string): Observable<StorageList> {
    const urlPath = `/v2/console/storage`;
    let params = new HttpParams();
    if (user_id) {
      params = params.set('user_id', user_id);
    }
    if (key) {
      params = params.set('key', key);
    }
    if (collection) {
      params = params.set('collection', collection);
    }
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    return this.httpClient.get<StorageList>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public listStorageCollections(auth_token: string): Observable<StorageCollectionsList> {
    const urlPath = `/v2/console/storage/collections`;
    let params = new HttpParams();
    return this.httpClient.get<StorageCollectionsList>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public listUsers(auth_token: string): Observable<UserList> {
    const urlPath = `/v2/console/user`;
    let params = new HttpParams();
    return this.httpClient.get<UserList>(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public unbanAccount(auth_token: string, id: string): Observable<any> {
    const urlPath = `/v2/console/account/${id}/unban`;
    let params = new HttpParams();
    return this.httpClient.post(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public unlinkApple(auth_token: string, id: string): Observable<any> {
    const urlPath = `/v2/console/account/${id}/unlink/apple`;
    let params = new HttpParams();
    return this.httpClient.post(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public unlinkCustom(auth_token: string, id: string): Observable<any> {
    const urlPath = `/v2/console/account/${id}/unlink/custom`;
    let params = new HttpParams();
    return this.httpClient.post(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public unlinkDevice(auth_token: string, id: string, body: UnlinkDeviceRequest): Observable<any> {
    const urlPath = `/v2/console/account/${id}/unlink/device`;
    let params = new HttpParams();
    return this.httpClient.post(this.config.host + urlPath, body, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public unlinkEmail(auth_token: string, id: string): Observable<any> {
    const urlPath = `/v2/console/account/${id}/unlink/email`;
    let params = new HttpParams();
    return this.httpClient.post(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public unlinkFacebook(auth_token: string, id: string): Observable<any> {
    const urlPath = `/v2/console/account/${id}/unlink/facebook`;
    let params = new HttpParams();
    return this.httpClient.post(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public unlinkFacebookInstantGame(auth_token: string, id: string): Observable<any> {
    const urlPath = `/v2/console/account/${id}/unlink/facebookinstantgame`;
    let params = new HttpParams();
    return this.httpClient.post(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public unlinkGameCenter(auth_token: string, id: string): Observable<any> {
    const urlPath = `/v2/console/account/${id}/unlink/gamecenter`;
    let params = new HttpParams();
    return this.httpClient.post(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public unlinkGoogle(auth_token: string, id: string): Observable<any> {
    const urlPath = `/v2/console/account/${id}/unlink/google`;
    let params = new HttpParams();
    return this.httpClient.post(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public unlinkSteam(auth_token: string, id: string): Observable<any> {
    const urlPath = `/v2/console/account/${id}/unlink/steam`;
    let params = new HttpParams();
    return this.httpClient.post(this.config.host + urlPath, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public updateAccount(auth_token: string, id: string, body: UpdateAccountRequest): Observable<any> {
    const urlPath = `/v2/console/account/${id}`;
    let params = new HttpParams();
    return this.httpClient.post(this.config.host + urlPath, body, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  public writeStorageObject(auth_token: string, collection: string, key: string, user_id: string, body: WriteStorageObjectRequest): Observable<ApiStorageObjectAck> {
    const urlPath = `/v2/console/storage/${collection}/${key}/${user_id}`;
    let params = new HttpParams();
    return this.httpClient.put<ApiStorageObjectAck>(this.config.host + urlPath, body, { params: params, headers: this.getTokenAuthHeaders(auth_token) })
  }

  private getTokenAuthHeaders(token: string): HttpHeaders {
    return new HttpHeaders().set('Authorization', 'Bearer ' + token);
  }

  private getBasicAuthHeaders(username: string, password: string): HttpHeaders {
    return new HttpHeaders().set('Authorization', 'Basic ' + btoa(username + ':' + password));
  }
}

export interface ApiAccount {
  user?: ApiUser
  wallet?: string
  email?: string
  devices?: ApiAccountDevice[]
  custom_id?: string
  verify_time?: string
  disable_time?: string
}

export interface ApiAccountDevice {
  id?: string
  vars?: AccountDeviceVarsEntry[]
}

export interface AccountDeviceVarsEntry {
  key?: string
  value?: string
}

export interface ApiChannelMessage {
  channel_id?: string
  message_id?: string
  code?: number
  sender_id?: string
  username?: string
  content?: string
  create_time?: string
  update_time?: string
  persistent?: boolean
  room_name?: string
  group_id?: string
  user_id_one?: string
  user_id_two?: string
}

export interface ApiFriend {
  user?: ApiUser
  state?: number
  update_time?: string
}

export interface ApiFriendList {
  friends?: ApiFriend[]
  cursor?: string
}

export interface ApiGroup {
  id?: string
  creator_id?: string
  name?: string
  description?: string
  lang_tag?: string
  metadata?: string
  avatar_url?: string
  open?: boolean
  edge_count?: number
  max_count?: number
  create_time?: string
  update_time?: string
}

export interface ApiLeaderboardRecord {
  leaderboard_id?: string
  owner_id?: string
  username?: string
  score?: string
  subscore?: string
  num_score?: number
  metadata?: string
  create_time?: string
  update_time?: string
  expiry_time?: string
  rank?: string
  max_num_score?: number
}

export interface ApiLeaderboardRecordList {
  records?: ApiLeaderboardRecord[]
  owner_records?: ApiLeaderboardRecord[]
  next_cursor?: string
  prev_cursor?: string
}

export interface ApiListLeaderboardRecordsRequest {
  leaderboard_id?: string
  owner_ids?: string[]
  limit?: number
  cursor?: string
  expiry?: string
}

export interface ApiListMatchesRequest {
  limit?: number
  authoritative?: boolean
  label?: string
  min_size?: number
  max_size?: number
  query?: string
}

export interface ApiMatch {
  match_id?: string
  authoritative?: boolean
  label?: string
  size?: number
  tick_rate?: number
  handler_name?: string
}

export interface ApiMatchList {
  matches?: ApiMatch[]
}

export interface ApiNotification {
  id?: string
  subject?: string
  content?: string
  code?: number
  sender_id?: string
  create_time?: string
  persistent?: boolean
}

export interface ApiPurchaseList {
  validated_purchases?: ApiValidatedPurchase[]
  cursor?: string
}

export interface ApiReadStorageObjectId {
  collection?: string
  key?: string
  user_id?: string
}

export interface ApiStorageObject {
  collection?: string
  key?: string
  user_id?: string
  value?: string
  version?: string
  permission_read?: number
  permission_write?: number
  create_time?: string
  update_time?: string
}

export interface ApiStorageObjectAck {
  collection?: string
  key?: string
  version?: string
  user_id?: string
}

export interface ApiUser {
  id?: string
  username?: string
  display_name?: string
  avatar_url?: string
  lang_tag?: string
  location?: string
  timezone?: string
  metadata?: string
  facebook_id?: string
  google_id?: string
  gamecenter_id?: string
  steam_id?: string
  online?: boolean
  edge_count?: number
  create_time?: string
  update_time?: string
  facebook_instant_game_id?: string
  apple_id?: string
}

export interface ApiUserGroupList {
  user_groups?: UserGroupListUserGroup[]
  cursor?: string
}

export interface UserGroupListUserGroup {
  group?: ApiGroup
  state?: number
}

export interface ApiValidatedPurchase {
  product_id?: string
  transaction_id?: string
  store?: ValidatedPurchaseStore
  purchase_time?: string
  create_time?: string
  update_time?: string
  provider_response?: string
  environment?: ValidatedPurchaseEnvironment
}

export interface Account {
  account?: ApiAccount
  disable_time?: string
}

export interface AccountDeleteRequest {
  id?: string
  record_deletion?: boolean
}

export interface AccountExport {
  account?: ApiAccount
  objects?: ApiStorageObject[]
  friends?: ApiFriend[]
  groups?: ApiGroup[]
  messages?: ApiChannelMessage[]
  leaderboard_records?: ApiLeaderboardRecord[]
  notifications?: ApiNotification[]
  wallet_ledgers?: WalletLedger[]
}

export interface AccountId {
  id?: string
}

export interface AccountList {
  users?: ApiUser[]
  total_count?: number
  next_cursor?: string
}

export interface AddUserRequest {
  username?: string
  password?: string
  email?: string
  role?: UserRole
  newsletter_subscription?: boolean
}

export interface ApiEndpointDescriptor {
  method?: string
  body_template?: string
}

export interface ApiEndpointList {
  endpoints?: ApiEndpointDescriptor[]
  rpc_endpoints?: ApiEndpointDescriptor[]
}

export interface AuthenticateRequest {
  username?: string
  password?: string
}

export interface CallApiEndpointRequest {
  method?: string
  body?: string
  user_id?: string
}

export interface CallApiEndpointResponse {
  body?: string
  error_message?: string
}

export interface Config {
  config?: string
  warnings?: ConfigWarning[]
  server_version?: string
}

export interface ConfigWarning {
  field?: string
  message?: string
}

export interface ConsoleSession {
  token?: string
}

export interface DeleteFriendRequest {
  id?: string
  friend_id?: string
}

export interface DeleteGroupUserRequest {
  id?: string
  group_id?: string
}

export interface DeleteLeaderboardRecordRequest {
  id?: string
  owner_id?: string
}

export interface DeleteStorageObjectRequest {
  collection?: string
  key?: string
  user_id?: string
  version?: string
}

export interface DeleteWalletLedgerRequest {
  id?: string
  wallet_id?: string
}

export interface Leaderboard {
  id?: string
  title?: string
  description?: string
  category?: number
  sort_order?: number
  size?: number
  max_size?: number
  max_num_score?: number
  operator?: number
  end_active?: number
  reset_schedule?: string
  metadata?: string
  create_time?: string
  start_time?: string
  end_time?: string
  duration?: number
  start_active?: number
  join_required?: boolean
  authoritative?: boolean
  tournament?: boolean
}

export interface LeaderboardList {
  leaderboards?: Leaderboard[]
}

export interface LeaderboardRequest {
  id?: string
}

export interface ListAccountsRequest {
  filter?: string
  tombstones?: boolean
  cursor?: string
}

export interface ListPurchasesRequest {
  user_id?: string
  limit?: number
  cursor?: string
}

export interface ListStorageRequest {
  user_id?: string
  key?: string
  collection?: string
  cursor?: string
}

export interface MatchState {
  presences?: RealtimeUserPresence[]
  tick?: string
  state?: string
}

export interface MatchStateRequest {
  id?: string
}

export interface RuntimeInfo {
  lua_rpc_functions?: string[]
  go_rpc_functions?: string[]
  js_rpc_functions?: string[]
  go_modules?: RuntimeInfoModuleInfo[]
  lua_modules?: RuntimeInfoModuleInfo[]
  js_modules?: RuntimeInfoModuleInfo[]
}

export interface RuntimeInfoModuleInfo {
  path?: string
  mod_time?: string
}

export interface StatusList {
  nodes?: StatusListStatus[]
  timestamp?: string
}

export interface StatusListStatus {
  name?: string
  health?: number
  session_count?: number
  presence_count?: number
  match_count?: number
  goroutine_count?: number
  avg_latency_ms?: number
  avg_rate_sec?: number
  avg_input_kbs?: number
  avg_output_kbs?: number
}

export interface StorageCollectionsList {
  collections?: string[]
}

export interface StorageList {
  objects?: ApiStorageObject[]
  total_count?: number
  next_cursor?: string
}

export interface UnlinkDeviceRequest {
  device_id?: string
}

export interface UpdateAccountRequest {
  username?: string
  display_name?: string
  metadata?: string
  avatar_url?: string
  lang_tag?: string
  location?: string
  timezone?: string
  custom_id?: string
  email?: string
  password?: string
  device_ids?: UpdateAccountRequestDeviceIdsEntry[]
  wallet?: string
}

export interface UpdateAccountRequestDeviceIdsEntry {
  key?: string
  value?: string
}

export interface UserList {
  users?: UserListUser[]
}

export interface UserListUser {
  username?: string
  email?: string
  role?: UserRole
}

export interface Username {
  username?: string
}

export interface WalletLedger {
  id?: string
  user_id?: string
  changeset?: string
  metadata?: string
  create_time?: string
  update_time?: string
}

export interface WalletLedgerList {
  items?: WalletLedger[]
}

export interface WriteStorageObjectRequest {
  value?: string
  version?: string
  permission_read?: number
  permission_write?: number
}

export interface RealtimeUserPresence {
  user_id?: string
  session_id?: string
  username?: string
  persistence?: boolean
  status?: string
}

export enum ValidatedPurchaseEnvironment {
  UNKNOWN = 0,
  SANDBOX = 1,
  PRODUCTION = 2,
}

export enum ValidatedPurchaseStore {
  APPLE_APP_STORE = 0,
  GOOGLE_PLAY_STORE = 1,
  HUAWEI_APP_GALLERY = 2,
}

export enum UserRole {
  USER_ROLE_UNKNOWN = 0,
  USER_ROLE_ADMIN = 1,
  USER_ROLE_DEVELOPER = 2,
  USER_ROLE_MAINTAINER = 3,
  USER_ROLE_READONLY = 4,
}
