export interface LoginRequest
{
  username: string,
  password: string,
  remember: boolean
};

export interface Token
{
  token: string
};

export enum LoginActionTypes
{
  LOGIN_REQUEST = '@@login/LOGIN_REQUEST',
  LOGIN_SUCCESS = '@@login/LOGIN_SUCCESS',
  LOGIN_ERROR = '@@login/LOGIN_ERROR',
  LOGOUT_REQUEST = '@@login/LOGOUT_REQUEST'
};

export interface LoginState
{
  readonly loading: boolean,
  readonly data: Token,
  readonly errors?: string
};
