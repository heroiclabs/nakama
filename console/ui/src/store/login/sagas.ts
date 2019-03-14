import {AnyAction} from 'redux';
import {all, call, fork, put, takeEvery} from 'redux-saga/effects';
import {LoginActionTypes} from './types';
import {loginError, loginSuccess} from './actions';

function* handleLogin({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(window.nakama_api.authenticate, data);
    
    if(res.error)
    {
      localStorage.clear();
      yield put(loginError(res.error));
    }
    else
    {
      if(data.remember)
      {
        localStorage.setItem('token', res.token);
      }
      yield put(loginSuccess(res));
    }
  }
  catch(err)
  {
    localStorage.clear();
    if(err.json)
    {
      const json = yield err.json();
      yield put(loginError(json.error || JSON.stringify(json)));
    }
    else if(err instanceof Error)
    {
      yield put(loginError('A network error occured. Are you sure the server is running and you are connected to the network?'));
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
