import {action} from 'typesafe-actions';
import {
  UserActionTypes,
  UserDeleteFriendRequest,
  UserDeleteGroupRequest,
  UserObjectRequest,
  UserUnlinkDeviceRequest,
  UserObject,
  ExportObject,
  UsersObjectRequest,
  UsersObject,
  LedgerObject,
  FriendObject,
  UserGroupObject,
  LedgerObjectRequest
} from './types';

export const userFetchManyRequest = (data: UsersObjectRequest) => action(
  UserActionTypes.FETCH_MANY_REQUEST,
  data
);
export const userFetchManySuccess = (data: UsersObject) => action(
  UserActionTypes.FETCH_MANY_SUCCESS,
  data
);
export const userFetchManyError = (message: string) => action(
  UserActionTypes.FETCH_MANY_ERROR,
  message
);

export const userDeleteManyRequest = (data: UserObjectRequest) => action(
  UserActionTypes.DELETE_MANY_REQUEST,
  data
);
export const userDeleteManySuccess = () => action(
  UserActionTypes.DELETE_MANY_SUCCESS
);
export const userDeleteManyError = (message: string) => action(
  UserActionTypes.DELETE_MANY_ERROR,
  message
);

export const userFetchRequest = (data: UserObjectRequest) => action(
  UserActionTypes.FETCH_REQUEST,
  data
);
export const userFetchSuccess = (data: ExportObject) => action(
  UserActionTypes.FETCH_SUCCESS,
  data
);
export const userFetchError = (message: string) => action(
  UserActionTypes.FETCH_ERROR,
  message
);

export const userExportRequest = (data: UserObjectRequest) => action(
  UserActionTypes.EXPORT_REQUEST,
  data
);
export const userExportSuccess = (data: ExportObject) => action(
  UserActionTypes.EXPORT_SUCCESS,
  data
);
export const userExportError = (message: string) => action(
  UserActionTypes.EXPORT_ERROR,
  message
);

export const userUpdateRequest = (data: UserObject) => action(
  UserActionTypes.UPDATE_REQUEST,
  data
);
export const userUpdateSuccess = () => action(
  UserActionTypes.UPDATE_SUCCESS
);
export const userUpdateError = (message: string) => action(
  UserActionTypes.UPDATE_ERROR,
  message
);

export const userDeleteRequest = (data: UserObjectRequest) => action(
  UserActionTypes.DELETE_REQUEST,
  data
);
export const userDeleteSuccess = () => action(
  UserActionTypes.DELETE_SUCCESS
);
export const userDeleteError = (message: string) => action(
  UserActionTypes.DELETE_ERROR,
  message
);

export const userBanRequest = (data: UserObjectRequest) => action(
  UserActionTypes.BAN_REQUEST,
  data
);
export const userBanSuccess = () => action(
  UserActionTypes.BAN_SUCCESS
);
export const userBanError = (message: string) => action(
  UserActionTypes.BAN_ERROR,
  message
);

export const userUnbanRequest = (data: UserObjectRequest) => action(
  UserActionTypes.UNBAN_REQUEST,
  data
);
export const userUnbanSuccess = () => action(
  UserActionTypes.UNBAN_SUCCESS
);
export const userUnbanError = (message: string) => action(
  UserActionTypes.UNBAN_ERROR,
  message
);

export const userFetchLedgerRequest = (data: UserObjectRequest) => action(
  UserActionTypes.FETCH_MANY_LEDGER_REQUEST,
  data
);
export const userFetchLedgerSuccess = (data: LedgerObject[]) => action(
  UserActionTypes.FETCH_MANY_LEDGER_SUCCESS,
  data
);
export const userFetchLedgerError = (message: string) => action(
  UserActionTypes.FETCH_MANY_LEDGER_ERROR,
  message
);

export const userDeleteLedgerRequest = (data: LedgerObjectRequest) => action(
  UserActionTypes.DELETE_LEDGER_REQUEST,
  data
);
export const userDeleteLedgerSuccess = () => action(
  UserActionTypes.DELETE_LEDGER_SUCCESS
);
export const userDeleteLedgerError = (message: string) => action(
  UserActionTypes.DELETE_LEDGER_ERROR,
  message
);

export const userFetchFriendRequest = (data: UserObjectRequest) => action(
  UserActionTypes.FETCH_MANY_FRIEND_REQUEST,
  data
);
export const userFetchFriendSuccess = (data: FriendObject[]) => action(
  UserActionTypes.FETCH_MANY_FRIEND_SUCCESS,
  data
);
export const userFetchFriendError = (message: string) => action(
  UserActionTypes.FETCH_MANY_FRIEND_ERROR,
  message
);

export const userDeleteFriendRequest = (data: UserDeleteFriendRequest) => action(
  UserActionTypes.DELETE_FRIEND_REQUEST,
  data
);
export const userDeleteFriendSuccess = () => action(
  UserActionTypes.DELETE_FRIEND_SUCCESS
);
export const userDeleteFriendError = (message: string) => action(
  UserActionTypes.DELETE_FRIEND_ERROR,
  message
);

export const userFetchGroupRequest = (data: UserObjectRequest) => action(
  UserActionTypes.FETCH_MANY_GROUP_REQUEST,
  data
);
export const userFetchGroupSuccess = (data: UserGroupObject[]) => action(
  UserActionTypes.FETCH_MANY_GROUP_SUCCESS,
  data
);
export const userFetchGroupError = (message: string) => action(
  UserActionTypes.FETCH_MANY_GROUP_ERROR,
  message
);

export const userDeleteGroupRequest = (data: UserDeleteGroupRequest) => action(
  UserActionTypes.DELETE_GROUP_REQUEST,
  data
);
export const userDeleteGroupSuccess = () => action(
  UserActionTypes.DELETE_GROUP_SUCCESS
);
export const userDeleteGroupError = (message: string) => action(
  UserActionTypes.DELETE_GROUP_ERROR,
  message
);

export const userUnlinkSteamRequest = (data: UserObjectRequest) => action(
  UserActionTypes.UNLINK_STEAM_REQUEST,
  data
);
export const userUnlinkSteamSuccess = () => action(
  UserActionTypes.UNLINK_STEAM_SUCCESS
);
export const userUnlinkSteamError = (message: string) => action(
  UserActionTypes.UNLINK_STEAM_ERROR,
  message
);

export const userUnlinkGoogleRequest = (data: UserObjectRequest) => action(
  UserActionTypes.UNLINK_GOOGLE_REQUEST,
  data
);
export const userUnlinkGoogleSuccess = () => action(
  UserActionTypes.UNLINK_GOOGLE_SUCCESS
);
export const userUnlinkGoogleError = (message: string) => action(
  UserActionTypes.UNLINK_GOOGLE_ERROR,
  message
);

export const userUnlinkGameCenterRequest = (data: UserObjectRequest) => action(
  UserActionTypes.UNLINK_GAMECENTER_REQUEST,
  data
);
export const userUnlinkGameCenterSuccess = () => action(
  UserActionTypes.UNLINK_GAMECENTER_SUCCESS
);
export const userUnlinkGameCenterError = (message: string) => action(
  UserActionTypes.UNLINK_GAMECENTER_ERROR,
  message
);

export const userUnlinkFacebookRequest = (data: UserObjectRequest) => action(
  UserActionTypes.UNLINK_FACEBOOK_REQUEST,
  data
);
export const userUnlinkFacebookSuccess = () => action(
  UserActionTypes.UNLINK_FACEBOOK_SUCCESS
);
export const userUnlinkFacebookError = (message: string) => action(
  UserActionTypes.UNLINK_FACEBOOK_ERROR,
  message
);

export const userUnlinkFacebookInstantGameRequest = (data: UserObjectRequest) => action(
  UserActionTypes.UNLINK_FACEBOOK_INSTANT_GAME_REQUEST,
  data
);
export const userUnlinkFacebookInstantGameSuccess = () => action(
  UserActionTypes.UNLINK_FACEBOOK_INSTANT_GAME_SUCCESS
);
export const userUnlinkFacebookInstantGameError = (message: string) => action(
  UserActionTypes.UNLINK_FACEBOOK_INSTANT_GAME_ERROR,
  message
);

export const userUnlinkEmailRequest = (data: UserObjectRequest) => action(
  UserActionTypes.UNLINK_EMAIL_REQUEST,
  data
);
export const userUnlinkEmailSuccess = () => action(
  UserActionTypes.UNLINK_EMAIL_SUCCESS
);
export const userUnlinkEmailError = (message: string) => action(
  UserActionTypes.UNLINK_EMAIL_ERROR,
  message
);

export const userUnlinkDeviceRequest = (data: UserUnlinkDeviceRequest) => action(
  UserActionTypes.UNLINK_DEVICE_REQUEST,
  data
);
export const userUnlinkDeviceSuccess = () => action(
  UserActionTypes.UNLINK_DEVICE_SUCCESS
);
export const userUnlinkDeviceError = (message: string) => action(
  UserActionTypes.UNLINK_DEVICE_ERROR,
  message
);

export const userUnlinkCustomRequest = (data: UserObjectRequest) => action(
  UserActionTypes.UNLINK_CUSTOM_REQUEST,
  data
);
export const userUnlinkCustomSuccess = () => action(
  UserActionTypes.UNLINK_CUSTOM_SUCCESS
);
export const userUnlinkCustomError = (message: string) => action(
  UserActionTypes.UNLINK_CUSTOM_ERROR,
  message
);
