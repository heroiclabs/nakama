import {AnyAction} from 'redux';
import {all, call, fork, put, takeEvery} from 'redux-saga/effects';
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

function* handleFetchMany({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.listStorage,
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
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(storageFetchManyError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(storageFetchManyError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(storageFetchManyError('An unknown error occured.'));
    }
  }
}

function* handleDeleteMany()
{
  try
  {
    const res = yield call(window.nakama_api.deleteStorage);
    if(res.error)
    {
      yield put(storageDeleteManyError(res.error));
    }
    else
    {
      yield put(storageDeleteManySuccess());
      yield handleFetchMany({type: '@@storage/FETCH_MANY_REQUEST', payload: {}});
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
      yield put(storageDeleteManyError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(storageDeleteManyError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(storageDeleteManyError('An unknown error occured.'));
    }
  }
}

function* handleCreate({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.writeStorageObject,
      data && data.collection,
      data && data.key,
      data && data.user_id,
      data
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
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(storageCreateError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(storageCreateError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(storageCreateError('An unknown error occured.'));
    }
  }
}

function* handleFetch({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.getStorage,
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
      if(!res.permission_read)
      {
        res.permission_read = 0;
      }
      if(!res.permission_write)
      {
        res.permission_write = 0;
      }
      yield put(storageFetchSuccess(res));
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
      yield put(storageFetchError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(storageFetchError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(storageFetchError('An unknown error occured.'));
    }
  }
}

function* handleUpdate({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.writeStorageObject,
      data && data.collection,
      data && data.key,
      data && data.user_id,
      data
    );
    if(res.error)
    {
      yield put(storageUpdateError(res.error));
    }
    else
    {
      yield put(storageUpdateError(''));
      yield put(storageUpdateSuccess());
      yield handleFetch({type: '@@storage/FETCH_REQUEST', payload: data});
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
      yield put(storageUpdateError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(storageUpdateError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(storageUpdateError('An unknown error occured.'));
    }
  }
}

function* handleDelete({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(
      window.nakama_api.deleteStorageObject,
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
      yield handleFetchMany({type: '@@storage/FETCH_MANY_REQUEST', payload: {user_id: data.filter} });
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
      yield put(storageDeleteError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(storageDeleteError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(storageDeleteError('An unknown error occured.'));
    }
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
