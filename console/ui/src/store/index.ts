import {combineReducers, Dispatch, Action, AnyAction} from 'redux';
import {all, fork} from 'redux-saga/effects';

import {loginSaga} from './login/sagas';
import {loginReducer} from './login/reducer';
import {LoginState} from './login/types';

export interface ConnectedReduxProps<A extends Action = AnyAction>
{
  dispatch: Dispatch<A>
};

export interface ApplicationState
{
  login: LoginState
};

export const createRootReducer = () =>
  combineReducers({
    login: loginReducer
  });

export function* rootSaga()
{
  yield all([
    fork(loginSaga)
  ]);
};
