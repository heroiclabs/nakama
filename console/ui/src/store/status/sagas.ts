import {all, call, fork, put, takeEvery} from 'redux-saga/effects';
import {StatusActionTypes} from './types';
import {statusError, statusSuccess} from './actions';

function* handleFetch()
{
  try
  {
    const res = yield call(window.nakama_api.getStatus);

    if(res.error)
    {
      yield put(statusError(res.error));
    }
    else
    {
      yield put(statusSuccess(res));
    }
  }
  catch(err)
  {
    if(err.status === 401)
    {
      localStorage.clear();
      window.location.href = '/';
    }
    else if(err.json)
    {
      const json = yield err.json();
      yield put(statusError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(statusError(err.stack!));
      // don't punt to the login screen. Just leave be.
    }
    else
    {
      yield put(statusError('An unknown error occured.'));
    }
  }
}

function* watchStatusRequest()
{
  yield takeEvery(StatusActionTypes.FETCH_REQUEST, handleFetch);
}

export function* statusSaga()
{
  yield all([fork(watchStatusRequest)]);
}
