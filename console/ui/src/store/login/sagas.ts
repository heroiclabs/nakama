import {AnyAction} from 'redux';
import {all, call, fork, put, takeEvery} from 'redux-saga/effects';
import {LoginActionTypes, LoginRequest} from './types';
import {loginError, loginSuccess} from './actions';
import {NakamaApi} from '../../api.gen';

const nakama = NakamaApi();

function* handleLogin({payload: data}: AnyAction)
{
  try
  {
    const res = yield call(nakama.authenticate.bind(nakama), data);
    
    if(res.error)
    {
      yield put(loginError(res.error));
    }
    else
    {
      if(data.remember)
      {
        localStorage.set('token', res.token);
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
