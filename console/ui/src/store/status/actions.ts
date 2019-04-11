import {action} from 'typesafe-actions';
import {StatusActionTypes, StatusNodes} from './types';

export const statusRequest = () => action(
  StatusActionTypes.FETCH_REQUEST
);
export const statusSuccess = (data: StatusNodes) => action(
  StatusActionTypes.FETCH_SUCCESS,
  data
);
export const statusError = (message: string) => action(
  StatusActionTypes.FETCH_ERROR,
  message
);
