import {all, call, fork, put, takeEvery, select} from 'redux-saga/effects';
import {ConfigurationActionTypes} from './types';
import {configurationError, configurationSuccess} from './actions';
import {NakamaApi} from '../../api.gen';

function* handleFetch()
{
  try
  {
    const nakama = NakamaApi({
      basePath: process.env.REACT_APP_BASE_PATH || 'http://127.0.0.1:80',
      bearerToken: yield select((state) => state.login.data.token),
      timeoutMs: 5000
    });
    const res = yield call(nakama.getConfig.bind(nakama));
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
    if(err instanceof Error)
    {
      yield put(configurationError(err.stack!));
    }
    else
    {
      yield put(configurationError('An unknown error occured.'));
    }
    localStorage.clear();
    window.location.href = '/login';
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
