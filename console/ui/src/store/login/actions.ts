import {action} from 'typesafe-actions';
import {LoginActionTypes, LoginRequest, Token} from './types';

export const loginRequest = (data: LoginRequest) => action(
  LoginActionTypes.LOGIN_REQUEST,
  data
);
export const loginSuccess = (data: Token) => action(
  LoginActionTypes.LOGIN_SUCCESS,
  data
);
export const loginError = (message: string) => action(
  LoginActionTypes.LOGIN_ERROR,
  message
);
export const logoutRequest = () => action(
  LoginActionTypes.LOGOUT_REQUEST
);
