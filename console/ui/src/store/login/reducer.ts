import {Reducer} from 'redux';
import {LoginState, LoginActionTypes} from './types';

const initialState: LoginState = {
  data:
  {
    token: ''
  },
  errors: undefined,
  loading: false
};

export const loginReducer: Reducer<LoginState> = (state = initialState, action) =>
{
  switch(action.type)
  {
    case LoginActionTypes.LOGIN_REQUEST:
      return {...state, loading: true};
    case LoginActionTypes.LOGIN_SUCCESS:
      return {...state, loading: false, data: action.payload};
    case LoginActionTypes.LOGIN_ERROR:
      return {...state, loading: false, errors: action.payload};
    case LoginActionTypes.LOGOUT_REQUEST:
      return initialState;
    default:
      return state;
  }
}
