import {Reducer} from 'redux';
import {ConfigurationState, ConfigurationActionTypes} from './types';

const initialState: ConfigurationState = {
  data:
  {
    config: {}
  },
  errors: undefined,
  loading: false
};

export const configurationReducer: Reducer<ConfigurationState> = (state = initialState, action) =>
{
  switch(action.type)
  {
    case ConfigurationActionTypes.FETCH_REQUEST:
      return {...state, loading: true};
    case ConfigurationActionTypes.FETCH_SUCCESS:
      return {...state, loading: false, errors: undefined, data: action.payload};
    case ConfigurationActionTypes.FETCH_ERROR:
      return {...state, loading: false, errors: action.payload, data: initialState.data};
    default:
      return state;
  }
}
