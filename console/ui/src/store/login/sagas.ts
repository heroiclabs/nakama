import {AnyAction} from 'redux';
import {all, call, fork, put, takeEvery} from 'redux-saga/effects';
import {LoginActionTypes} from './types';
import {loginError, loginSuccess} from './actions';
import {NakamaApi} from '../../api.gen';

function* handleLogin({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(window.nakama_api.authenticate, data);
    
    if(res.error)
    {
      yield put(loginError(res.error));
    }
    else
    {
      window.nakama_api = NakamaApi({
        basePath: process.env.REACT_APP_BASE_PATH || 'http://127.0.0.1:80',
        bearerToken: res.token,
        timeoutMs: 5000
      });
      if(data.remember)
      {
        localStorage.setItem('token', res.token);
      }
      yield put(loginSuccess(res));
    }
  }
  catch(err)
  {
    console.error(err);
    if(err instanceof Error)
    {
      yield put(loginError(err.stack!));
    }
    else
    {
      yield put(loginError('An unknown error occured.'));
    }
  }
}

function* watchLoginRequest()
{
  yield takeEvery(LoginActionTypes.LOGIN_REQUEST, handleLogin);
}

export function* loginSaga()
{
  yield all([fork(watchLoginRequest)]);
}
