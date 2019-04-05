import {combineReducers, Dispatch, Action, AnyAction} from 'redux';
import {all, fork} from 'redux-saga/effects';

import {loginSaga} from './login/sagas';
import {loginReducer} from './login/reducer';
import {LoginState} from './login/types';

import {configurationSaga} from './configuration/sagas';
import {configurationReducer} from './configuration/reducer';
import {ConfigurationState} from './configuration/types';

import {storageSaga} from './storage/sagas';
import {storageReducer, storagesReducer} from './storage/reducer';
import {StorageState, StoragesState} from './storage/types';

export interface ConnectedReduxProps<A extends Action = AnyAction>
{
  dispatch: Dispatch<A>
};

export interface ApplicationState
{
  login: LoginState,
  configuration: ConfigurationState,
  storage: StoragesState,
  storage_details: StorageState
};

export const createRootReducer = () =>
  combineReducers({
    login: loginReducer,
    configuration: configurationReducer,
    storage: storagesReducer,
    storage_details: storageReducer
  });

export function* rootSaga()
{
  yield all([
    fork(loginSaga),
    fork(configurationSaga),
    fork(storageSaga)
  ]);
};
