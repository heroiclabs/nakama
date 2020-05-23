import {AnyAction} from 'redux';
import {all, call, fork, put, takeEvery} from 'redux-saga/effects';
import {UserActionTypes} from './types';
import {
  userFetchManySuccess,
  userFetchManyError,
  userDeleteManySuccess,
  userDeleteManyError,
  userFetchSuccess,
  userFetchError,
  userExportSuccess,
  userExportError,
  userUpdateSuccess,
  userUpdateError,
  userDeleteSuccess,
  userDeleteError,
  userBanSuccess,
  userBanError,
  userUnbanSuccess,
  userUnbanError,
  userFetchLedgerSuccess,
  userFetchLedgerError,
  userDeleteLedgerSuccess,
  userDeleteLedgerError,
  userFetchFriendSuccess,
  userFetchFriendError,
  userDeleteFriendSuccess,
  userDeleteFriendError,
  userFetchGroupSuccess,
  userFetchGroupError,
  userDeleteGroupSuccess,
  userDeleteGroupError,
  userUnlinkSteamSuccess,
  userUnlinkSteamError,
  userUnlinkGoogleSuccess,
  userUnlinkGoogleError,
  userUnlinkGameCenterSuccess,
  userUnlinkGameCenterError,
  userUnlinkFacebookSuccess,
  userUnlinkFacebookError,
  userUnlinkFacebookInstantGameSuccess,
  userUnlinkFacebookInstantGameError,
  userUnlinkEmailSuccess,
  userUnlinkEmailError,
  userUnlinkDeviceSuccess,
  userUnlinkDeviceError,
  userUnlinkCustomSuccess,
  userUnlinkCustomError
} from './actions';

function* handleFetchMany({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.listUsers,
      data && data.filter,
      data && data.banned,
      data && data.tombstones
    );
    if(res.error)
    {
      yield put(userFetchManyError(res.error));
    }
    else
    {
      yield put(userFetchManySuccess(res));
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userFetchManyError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userFetchManyError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userFetchManyError('An unknown error occurred.'));
    }
  }
}

function* handleDeleteMany({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(window.nakama_api.deleteUsers);
    if(res.error)
    {
      yield put(userDeleteManyError(res.error));
    }
    else
    {
      yield put(userDeleteManySuccess());
      if(typeof data.filter !== 'undefined')
      {
        yield handleFetchMany({type: '@@user/FETCH_MANY_REQUEST', payload: data});
      }
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userDeleteManyError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userDeleteManyError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userDeleteManyError('An unknown error occurred.'));
    }
  }
}

function* handleFetch({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.getAccount,
      data && data.id
    );
    if(res.error)
    {
      yield put(userFetchError(res.error));
    }
    else
    {
      yield put(userFetchSuccess(res));
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if (err.status == 404) // tombstoned users
    {
      window.location.href = '/users';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userFetchError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userFetchError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userFetchError('An unknown error occurred.'));
    }
  }
}

function* handleExport({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.exportAccount,
      data && data.id
    );
    if(res.error)
    {
      yield put(userExportError(res.error));
    }
    else
    {
      yield put(userExportSuccess(res));
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userExportError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userExportError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userExportError('An unknown error occurred.'));
    }
  }
}

function* handleUpdate({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.updateAccount,
      data && data.id,
      data
    );
    if(res.error)
    {
      yield put(userUpdateError(res.error));
    }
    else
    {
      yield put(userUpdateError(''));
      yield put(userUpdateSuccess());
      yield handleFetch({type: '@@user/FETCH_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userUpdateError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userUpdateError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userUpdateError('An unknown error occurred.'));
    }
  }
}

function* handleDelete({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.deleteAccount,
      data && data.id,
      data && data.recorded
    );
    if(res.error)
    {
      yield put(userDeleteError(res.error));
    }
    else
    {
      yield put(userDeleteSuccess());
      if(typeof data.filter !== 'undefined')
      {
        yield handleFetchMany({type: '@@user/FETCH_MANY_REQUEST', payload: data});
      }
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userDeleteError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userDeleteError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userDeleteError('An unknown error occurred.'));
    }
  }
}

function* handleBan({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.banUser,
      data && data.id
    );
    if(res.error)
    {
      yield put(userBanError(res.error));
    }
    else
    {
      yield put(userBanSuccess());
      yield handleFetch({type: '@@user/FETCH_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userBanError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userBanError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userBanError('An unknown error occurred.'));
    }
  }
}

function* handleUnban({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.unbanUser,
      data && data.id
    );
    if(res.error)
    {
      yield put(userUnbanError(res.error));
    }
    else
    {
      yield put(userUnbanSuccess());
      yield handleFetch({type: '@@user/FETCH_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userUnbanError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userUnbanError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userUnbanError('An unknown error occurred.'));
    }
  }
}

function* handleFetchLedger({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.getWalletLedger,
      data && data.id
    );
    if(res.error)
    {
      yield put(userFetchLedgerError(res.error));
    }
    else
    {
      yield put(userFetchLedgerSuccess(res.items));
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userFetchLedgerError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userFetchLedgerError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userFetchLedgerError('An unknown error occurred.'));
    }
  }
}

function* handleDeleteLedger({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.deleteWalletLedger,
      data && data.id,
      data && data.walletId
    );
    if(res.error)
    {
      yield put(userDeleteLedgerError(res.error));
    }
    else
    {
      yield put(userDeleteLedgerSuccess());
      yield handleFetchLedger({type: '@@user/FETCH_MANY_LEDGER_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userDeleteLedgerError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userDeleteLedgerError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userDeleteLedgerError('An unknown error occurred.'));
    }
  }
}

function* handleFetchFriend({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.getFriends,
      data && data.id
    );
    if(res.error)
    {
      yield put(userFetchFriendError(res.error));
    }
    else
    {
      yield put(userFetchFriendSuccess(res.friends || []));
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userFetchFriendError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userFetchFriendError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userFetchFriendError('An unknown error occurred.'));
    }
  }
}

function* handleDeleteFriend({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.deleteFriend,
      data && data.id,
      data && data.friendId
    );
    if(res.error)
    {
      yield put(userDeleteFriendError(res.error));
    }
    else
    {
      yield put(userDeleteFriendSuccess());
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userDeleteFriendError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userDeleteFriendError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userDeleteFriendError('An unknown error occurred.'));
    }
  }
}

function* handleFetchGroup({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.getGroups,
      data && data.id
    );
    if(res.error)
    {
      yield put(userFetchGroupError(res.error));
    }
    else
    {
      yield put(userFetchGroupSuccess(res.user_groups || []));
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userFetchGroupError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userFetchGroupError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userFetchGroupError('An unknown error occurred.'));
    }
  }
}

function* handleDeleteGroup({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.deleteGroupUser,
      data && data.id,
      data && data.groupId
    );
    if(res.error)
    {
      yield put(userDeleteGroupError(res.error));
    }
    else
    {
      yield put(userDeleteGroupSuccess());
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userDeleteGroupError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userDeleteGroupError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userDeleteGroupError('An unknown error occurred.'));
    }
  }
}

function* handleUnlinkSteam({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.unlinkSteam,
      data && data.id
    );
    if(res.error)
    {
      yield put(userUnlinkSteamError(res.error));
    }
    else
    {
      yield put(userUnlinkSteamSuccess());
      yield handleFetch({type: '@@user/FETCH_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userUnlinkSteamError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userUnlinkSteamError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userUnlinkSteamError('An unknown error occurred.'));
    }
  }
}

function* handleUnlinkGoogle({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.unlinkGoogle,
      data && data.id
    );
    if(res.error)
    {
      yield put(userUnlinkGoogleError(res.error));
    }
    else
    {
      yield put(userUnlinkGoogleSuccess());
      yield handleFetch({type: '@@user/FETCH_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userUnlinkGoogleError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userUnlinkGoogleError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userUnlinkGoogleError('An unknown error occurred.'));
    }
  }
}

function* handleUnlinkGameCenter({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.unlinkGameCenter,
      data && data.id
    );
    if(res.error)
    {
      yield put(userUnlinkGameCenterError(res.error));
    }
    else
    {
      yield put(userUnlinkGameCenterSuccess());
      yield handleFetch({type: '@@user/FETCH_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userUnlinkGameCenterError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userUnlinkGameCenterError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userUnlinkGameCenterError('An unknown error occurred.'));
    }
  }
}

function* handleUnlinkFacebook({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.unlinkFacebook,
      data && data.id
    );
    if(res.error)
    {
      yield put(userUnlinkFacebookError(res.error));
    }
    else
    {
      yield put(userUnlinkFacebookSuccess());
      yield handleFetch({type: '@@user/FETCH_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userUnlinkFacebookError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userUnlinkFacebookError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userUnlinkFacebookError('An unknown error occurred.'));
    }
  }
}

function* handleUnlinkFacebookInstantGame({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.unlinkFacebookInstantGame,
      data && data.id
    );
    if(res.error)
    {
      yield put(userUnlinkFacebookInstantGameError(res.error));
    }
    else
    {
      yield put(userUnlinkFacebookInstantGameSuccess());
      yield handleFetch({type: '@@user/FETCH_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userUnlinkFacebookInstantGameError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userUnlinkFacebookInstantGameError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userUnlinkFacebookInstantGameError('An unknown error occurred.'));
    }
  }
}

function* handleUnlinkEmail({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.unlinkEmail,
      data && data.id
    );
    if(res.error)
    {
      yield put(userUnlinkEmailError(res.error));
    }
    else
    {
      yield put(userUnlinkEmailSuccess());
      yield handleFetch({type: '@@user/FETCH_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userUnlinkEmailError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userUnlinkEmailError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userUnlinkEmailError('An unknown error occurred.'));
    }
  }
}

function* handleUnlinkDevice({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.unlinkDevice,
      data && data.id,
      data
    );
    if(res.error)
    {
      yield put(userUnlinkDeviceError(res.error));
    }
    else
    {
      yield put(userUnlinkDeviceSuccess());
      yield handleFetch({type: '@@user/FETCH_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userUnlinkDeviceError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userUnlinkDeviceError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userUnlinkDeviceError('An unknown error occurred.'));
    }
  }
}

function* handleUnlinkCustom({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.unlinkCustom,
      data && data.id
    );
    if(res.error)
    {
      yield put(userUnlinkCustomError(res.error));
    }
    else
    {
      yield put(userUnlinkCustomSuccess());
      yield handleFetch({type: '@@user/FETCH_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userUnlinkCustomError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userUnlinkCustomError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(userUnlinkCustomError('An unknown error occurred.'));
    }
  }
}

function* watchFetchMany()
{
  yield takeEvery(UserActionTypes.FETCH_MANY_REQUEST, handleFetchMany);
}

function* watchDeleteMany()
{
  yield takeEvery(UserActionTypes.DELETE_MANY_REQUEST, handleDeleteMany);
}

function* watchFetch()
{
  yield takeEvery(UserActionTypes.FETCH_REQUEST, handleFetch);
}

function* watchExport()
{
  yield takeEvery(UserActionTypes.EXPORT_REQUEST, handleExport);
}

function* watchUpdate()
{
  yield takeEvery(UserActionTypes.UPDATE_REQUEST, handleUpdate);
}

function* watchDelete()
{
  yield takeEvery(UserActionTypes.DELETE_REQUEST, handleDelete);
}

function* watchBan()
{
  yield takeEvery(UserActionTypes.BAN_REQUEST, handleBan);
}

function* watchUnban()
{
  yield takeEvery(UserActionTypes.UNBAN_REQUEST, handleUnban);
}

function* watchFetchLedger()
{
  yield takeEvery(UserActionTypes.FETCH_MANY_LEDGER_REQUEST, handleFetchLedger);
}

function* watchDeleteLedger()
{
  yield takeEvery(UserActionTypes.DELETE_LEDGER_REQUEST, handleDeleteLedger);
}

function* watchFetchFriend()
{
  yield takeEvery(UserActionTypes.FETCH_MANY_FRIEND_REQUEST, handleFetchFriend);
}

function* watchDeleteFriend()
{
  yield takeEvery(UserActionTypes.DELETE_FRIEND_REQUEST, handleDeleteFriend);
}

function* watchFetchGroup()
{
  yield takeEvery(UserActionTypes.FETCH_MANY_GROUP_REQUEST, handleFetchGroup);
}

function* watchDeleteGroup()
{
  yield takeEvery(UserActionTypes.DELETE_GROUP_REQUEST, handleDeleteGroup);
}

function* watchUnlinkSteam()
{
  yield takeEvery(UserActionTypes.UNLINK_STEAM_REQUEST, handleUnlinkSteam);
}

function* watchUnlinkGoogle()
{
  yield takeEvery(UserActionTypes.UNLINK_GOOGLE_REQUEST, handleUnlinkGoogle);
}

function* watchUnlinkGameCenter()
{
  yield takeEvery(UserActionTypes.UNLINK_GAMECENTER_REQUEST, handleUnlinkGameCenter);
}

function* watchUnlinkFacebook()
{
  yield takeEvery(UserActionTypes.UNLINK_FACEBOOK_REQUEST, handleUnlinkFacebook);
}

function* watchUnlinkFacebookInstantGame()
{
  yield takeEvery(UserActionTypes.UNLINK_FACEBOOK_INSTANT_GAME_REQUEST, handleUnlinkFacebookInstantGame);
}

function* watchUnlinkEmail()
{
  yield takeEvery(UserActionTypes.UNLINK_EMAIL_REQUEST, handleUnlinkEmail);
}

function* watchUnlinkDevice()
{
  yield takeEvery(UserActionTypes.UNLINK_DEVICE_REQUEST, handleUnlinkDevice);
}

function* watchUnlinkCustom()
{
  yield takeEvery(UserActionTypes.UNLINK_CUSTOM_REQUEST, handleUnlinkCustom);
}

export function* userSaga()
{
  yield all([
    fork(watchFetchMany),
    fork(watchDeleteMany),
    fork(watchFetch),
    fork(watchExport),
    fork(watchUpdate),
    fork(watchDelete),
    fork(watchBan),
    fork(watchUnban),
    fork(watchFetchLedger),
    fork(watchDeleteLedger),
    fork(watchFetchFriend),
    fork(watchDeleteFriend),
    fork(watchFetchGroup),
    fork(watchDeleteGroup),
    fork(watchUnlinkSteam),
    fork(watchUnlinkGoogle),
    fork(watchUnlinkGameCenter),
    fork(watchUnlinkFacebook),
    fork(watchUnlinkFacebookInstantGame),
    fork(watchUnlinkEmail),
    fork(watchUnlinkDevice),
    fork(watchUnlinkCustom)
  ]);
}
