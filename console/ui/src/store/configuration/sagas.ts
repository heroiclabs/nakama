import {all, call, fork, put, takeEvery} from 'redux-saga/effects';
import {ConfigurationActionTypes} from './types';
import {configurationError, configurationSuccess} from './actions';

function* handleFetch()
{
  try
  {
    const res = yield call(window.nakama_api.getConfig);
    res.config = (res.config ? JSON.parse(res.config) : {});

    if(res.error)
    {
      yield put(configurationError(res.error));
    }
    else
    {
      yield put(configurationSuccess(res));
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
      yield put(configurationError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(configurationError(err.stack!));
      localStorage.clear();
      window.location.href = '/';
    }
    else
    {
      yield put(configurationError('An unknown error occured.'));
    }
  }
}

function* watchConfigurationRequest()
{
  yield takeEvery(ConfigurationActionTypes.FETCH_REQUEST, handleFetch);
}

export function* configurationSaga()
{
  yield all([fork(watchConfigurationRequest)]);
}
