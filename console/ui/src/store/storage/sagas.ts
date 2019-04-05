import {AnyAction} from 'redux';
import {all, call, fork, put, takeEvery, select} from 'redux-saga/effects';
import {StorageActionTypes} from './types';
import {
  storageFetchManySuccess,
  storageFetchManyError,
  storageDeleteManySuccess,
  storageDeleteManyError,
  storageCreateSuccess,
  storageCreateError,
  storageFetchSuccess,
  storageFetchError,
  storageUpdateSuccess,
  storageUpdateError,
  storageDeleteSuccess,
  storageDeleteError
} from './actions';
import {NakamaApi} from '../../api.gen';

function* handleFetchMany({payload: data}: AnyAction)
{
  try
  {
    const nakama = NakamaApi({
      basePath: process.env.REACT_APP_BASE_PATH || 'http://127.0.0.1:80',
      bearerToken: yield select((state) => state.login.data.token),
      timeoutMs: 5000
    });
    const res = yield call(
      nakama.listStorage.bind(nakama),
      data && data.user_id
    );
    if(res.error)
    {
      yield put(storageFetchManyError(res.error));
    }
    else
    {
      yield put(storageFetchManySuccess(res));
    }
  }
  catch(err)
  {
    console.error(err);
    if(err instanceof Error)
    {
      yield put(storageFetchManyError(err.stack!));
    }
    else
    {
      yield put(storageFetchManyError('An unknown error occured.'));
    }
    localStorage.clear();
    window.location.href = '/login';
  }
}

function* handleDeleteMany()
{
  try
  {
    const nakama = NakamaApi({
      basePath: process.env.REACT_APP_BASE_PATH || 'http://127.0.0.1:80',
      bearerToken: yield select((state) => state.login.data.token),
      timeoutMs: 5000
    });
    const res = yield call(nakama.deleteStorage.bind(nakama));
    if(res.error)
    {
      yield put(storageDeleteManyError(res.error));
    }
    else
    {
      yield put(storageDeleteManySuccess());
    }
  }
  catch(err)
  {
    console.error(err);
    if(err instanceof Error)
    {
      yield put(storageDeleteManyError(err.stack!));
    }
    else
    {
      yield put(storageDeleteManyError('An unknown error occured.'));
    }
    localStorage.clear();
    window.location.href = '/login';
  }
}

function* handleCreate({payload: data}: AnyAction)
{
  try
  {
    const nakama = NakamaApi({
      basePath: process.env.REACT_APP_BASE_PATH || 'http://127.0.0.1:80',
      bearerToken: yield select((state) => state.login.data.token),
      timeoutMs: 5000
    });
    const res = yield call(
      nakama.writeStorageObject.bind(nakama),
      data && data.collection,
      data && data.key,
      data && data.user_id
    );
    if(res.error)
    {
      yield put(storageCreateError(res.error));
    }
    else
    {
      yield put(storageCreateSuccess(res));
    }
  }
  catch(err)
  {
    console.error(err);
    if(err instanceof Error)
    {
      yield put(storageCreateError(err.stack!));
    }
    else
    {
      yield put(storageCreateError('An unknown error occured.'));
    }
    localStorage.clear();
    window.location.href = '/login';
  }
}

function* handleFetch({payload: data}: AnyAction)
{
  try
  {
    const nakama = NakamaApi({
      basePath: process.env.REACT_APP_BASE_PATH || 'http://127.0.0.1:80',
      bearerToken: yield select((state) => state.login.data.token),
      timeoutMs: 5000
    });
    const res = yield call(
      nakama.getStorage.bind(nakama),
      data && data.collection,
      data && data.key,
      data && data.user_id
    );
    if(res.error)
    {
      yield put(storageFetchError(res.error));
    }
    else
    {
      yield put(storageFetchSuccess(res));
    }
  }
  catch(err)
  {
    console.error(err);
    if(err instanceof Error)
    {
      yield put(storageFetchError(err.stack!));
    }
    else
    {
      yield put(storageFetchError('An unknown error occured.'));
    }
    localStorage.clear();
    window.location.href = '/login';
  }
}

function* handleUpdate({payload: data}: AnyAction)
{
  try
  {
    const nakama = NakamaApi({
      basePath: process.env.REACT_APP_BASE_PATH || 'http://127.0.0.1:80',
      bearerToken: yield select((state) => state.login.data.token),
      timeoutMs: 5000
    });
    const res = yield call(
      nakama.writeStorageObject.bind(nakama),
      data && data.collection,
      data && data.key,
      data && data.user_id
    );
    if(res.error)
    {
      yield put(storageUpdateError(res.error));
    }
    else
    {
      yield put(storageUpdateSuccess(res));
    }
  }
  catch(err)
  {
    console.error(err);
    if(err instanceof Error)
    {
      yield put(storageUpdateError(err.stack!));
    }
    else
    {
      yield put(storageUpdateError('An unknown error occured.'));
    }
    localStorage.clear();
    window.location.href = '/login';
  }
}

function* handleDelete({payload: data}: AnyAction)
{
  try
  {
    const nakama = NakamaApi({
      basePath: process.env.REACT_APP_BASE_PATH || 'http://127.0.0.1:80',
      bearerToken: yield select((state) => state.login.data.token),
      timeoutMs: 5000
    });
    const res = yield call(
      nakama.deleteStorageObject.bind(nakama),
      data && data.collection,
      data && data.key,
      data && data.user_id
    );
    if(res.error)
    {
      yield put(storageDeleteError(res.error));
    }
    else
    {
      yield put(storageDeleteSuccess());
    }
  }
  catch(err)
  {
    console.error(err);
    if(err instanceof Error)
    {
      yield put(storageDeleteError(err.stack!));
    }
    else
    {
      yield put(storageDeleteError('An unknown error occured.'));
    }
    localStorage.clear();
    window.location.href = '/login';
  }
}

function* watchFetchMany()
{
  yield takeEvery(StorageActionTypes.FETCH_MANY_REQUEST, handleFetchMany);
}

function* watchDeleteMany()
{
  yield takeEvery(StorageActionTypes.DELETE_MANY_REQUEST, handleDeleteMany);
}

function* watchCreate()
{
  yield takeEvery(StorageActionTypes.CREATE_REQUEST, handleCreate);
}

function* watchFetch()
{
  yield takeEvery(StorageActionTypes.FETCH_REQUEST, handleFetch);
}

function* watchUpdate()
{
  yield takeEvery(StorageActionTypes.UPDATE_REQUEST, handleUpdate);
}

function* watchDelete()
{
  yield takeEvery(StorageActionTypes.DELETE_REQUEST, handleDelete);
}

export function* storageSaga()
{
  yield all([
    fork(watchFetchMany),
    fork(watchDeleteMany),
    fork(watchCreate),
    fork(watchFetch),
    fork(watchUpdate),
    fork(watchDelete)
  ]);
}
