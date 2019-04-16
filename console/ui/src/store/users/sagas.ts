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
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userFetchManyError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userFetchManyError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userFetchManyError('An unknown error occured.'));
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
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userDeleteManyError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userDeleteManyError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userDeleteManyError('An unknown error occured.'));
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
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userFetchError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userFetchError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userFetchError('An unknown error occured.'));
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
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userExportError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userExportError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userExportError('An unknown error occured.'));
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
      yield handleExport({type: '@@user/EXPORT_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userUpdateError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userUpdateError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userUpdateError('An unknown error occured.'));
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
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userDeleteError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userDeleteError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userDeleteError('An unknown error occured.'));
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
      yield handleExport({type: '@@user/EXPORT_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userBanError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userBanError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userBanError('An unknown error occured.'));
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
      yield handleExport({type: '@@user/EXPORT_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userUnbanError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userUnbanError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userUnbanError('An unknown error occured.'));
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
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userFetchLedgerError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userFetchLedgerError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userFetchLedgerError('An unknown error occured.'));
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
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userDeleteLedgerError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userDeleteLedgerError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userDeleteLedgerError('An unknown error occured.'));
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
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userFetchFriendError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userFetchFriendError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userFetchFriendError('An unknown error occured.'));
    }
  }
}

function* handleDeleteFriend({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.deleteFriend,
      data && data.id
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
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userDeleteFriendError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userDeleteFriendError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userDeleteFriendError('An unknown error occured.'));
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
      yield put(userFetchGroupSuccess(res.groups || []));
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userFetchGroupError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userFetchGroupError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userFetchGroupError('An unknown error occured.'));
    }
  }
}

function* handleDeleteGroup({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.deleteGroupUser,
      data && data.id
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
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userDeleteGroupError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userDeleteGroupError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userDeleteGroupError('An unknown error occured.'));
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
      yield handleExport({type: '@@user/EXPORT_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userUnlinkSteamError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userUnlinkSteamError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userUnlinkSteamError('An unknown error occured.'));
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
      yield handleExport({type: '@@user/EXPORT_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userUnlinkGoogleError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userUnlinkGoogleError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userUnlinkGoogleError('An unknown error occured.'));
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
      yield handleExport({type: '@@user/EXPORT_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userUnlinkGameCenterError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userUnlinkGameCenterError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userUnlinkGameCenterError('An unknown error occured.'));
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
      yield handleExport({type: '@@user/EXPORT_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userUnlinkFacebookError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userUnlinkFacebookError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userUnlinkFacebookError('An unknown error occured.'));
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
      yield handleExport({type: '@@user/EXPORT_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userUnlinkEmailError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userUnlinkEmailError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userUnlinkEmailError('An unknown error occured.'));
    }
  }
}

function* handleUnlinkDevice({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.unlinkDevice,
      data && data.id
    );
    if(res.error)
    {
      yield put(userUnlinkDeviceError(res.error));
    }
    else
    {
      yield put(userUnlinkDeviceSuccess());
      yield handleExport({type: '@@user/EXPORT_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userUnlinkDeviceError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userUnlinkDeviceError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userUnlinkDeviceError('An unknown error occured.'));
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
      yield handleExport({type: '@@user/EXPORT_REQUEST', payload: data});
    }
  }
  catch(err)
  {
    console.error(err);
    if(err.status === 401)
    {
      window.location.href = '/login';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(userUnlinkCustomError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(userUnlinkCustomError(err.stack!));
      window.location.href = '/login';
    }
    else
    {
      yield put(userUnlinkCustomError('An unknown error occured.'));
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
    fork(watchUnlinkEmail),
    fork(watchUnlinkDevice),
    fork(watchUnlinkCustom)
  ]);
}
