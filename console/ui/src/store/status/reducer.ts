import {Reducer} from 'redux';
import {StatusState, StatusActionTypes} from './types';

const initialState: StatusState = {
  data:
  {
    nodes: []
  },
  errors: undefined,
  loading: false
};

export const statusReducer: Reducer<StatusState> = (state = initialState, action) =>
{
  switch(action.type)
  {
    case StatusActionTypes.FETCH_REQUEST:
      return {...state, loading: true};
    case StatusActionTypes.FETCH_SUCCESS:
      return {...state, loading: false, errors: undefined, data: action.payload};
    case StatusActionTypes.FETCH_ERROR:
      return {...state, loading: false, errors: action.payload, data: initialState.data};
    default:
      return state;
  }
}
