import {action} from 'typesafe-actions';
import {ConfigurationActionTypes, Config} from './types';

export const configurationRequest = () => action(
  ConfigurationActionTypes.FETCH_REQUEST
);
export const configurationSuccess = (data: Config) => action(
  ConfigurationActionTypes.FETCH_SUCCESS,
  data
);
export const configurationError = (message: string) => action(
  ConfigurationActionTypes.FETCH_ERROR,
  message
);
