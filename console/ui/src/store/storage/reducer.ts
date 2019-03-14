import {Reducer} from 'redux';
import {StorageState, StoragesState, StorageActionTypes} from './types';

const initialStoragesState: StoragesState = {
  data:
  {
    objects: [],
    total_count: 0
  },
  errors: undefined,
  loading: false
};

export const storagesReducer: Reducer<StoragesState> = (state = initialStoragesState, action) =>
{
  switch(action.type)
  {
    case StorageActionTypes.FETCH_MANY_REQUEST:
      return {...state, loading: true};
    case StorageActionTypes.FETCH_MANY_SUCCESS:
      return {...state, loading: false, errors: undefined, data: action.payload};
    case StorageActionTypes.FETCH_MANY_ERROR:
      return {...state, loading: false, errors: action.payload, data: initialStoragesState.data};
    case StorageActionTypes.DELETE_MANY_REQUEST:
      return {...state, loading: true};
    case StorageActionTypes.DELETE_MANY_SUCCESS:
      return {...state, loading: false, errors: undefined};
    case StorageActionTypes.DELETE_MANY_ERROR:
      return {...state, loading: false, errors: action.payload};
    case StorageActionTypes.DELETE_REQUEST:
      return {...state, loading: true};
    case StorageActionTypes.DELETE_SUCCESS:
      return {...state, loading: false, errors: undefined};
    case StorageActionTypes.DELETE_ERROR:
      return {...state, loading: false, errors: action.payload};
    default:
      return state;
  }
}

const initialStorageState: StorageState = {
  data:
  {
    collection: '',
    key: '',
    user_id: '',
    value: '',
    version: '',
    permission_read: 1,
    permission_write: 1,
    create_time: '',
    update_time: ''
  },
  updated: false,
  errors: undefined,
  loading: false
};

export const storageReducer: Reducer<StorageState> = (state = initialStorageState, action) =>
{
  switch(action.type)
  {
    case StorageActionTypes.CREATE_REQUEST:
      return {...state, loading: true};
    case StorageActionTypes.CREATE_SUCCESS:
      return {...state, loading: false, errors: undefined, data: action.payload};
    case StorageActionTypes.CREATE_ERROR:
      return {...state, loading: false, errors: action.payload, data: initialStorageState.data};
    case StorageActionTypes.FETCH_REQUEST:
      return {...state, loading: true};
    case StorageActionTypes.FETCH_SUCCESS:
      return {...state, loading: false, errors: undefined, data: action.payload};
    case StorageActionTypes.FETCH_ERROR:
      return {...state, loading: false, errors: action.payload, data: initialStorageState.data};
    case StorageActionTypes.UPDATE_REQUEST:
      return {...state, loading: true};
    case StorageActionTypes.UPDATE_SUCCESS:
      return {...state, loading: false, errors: undefined, updated: true};
    case StorageActionTypes.UPDATE_ERROR:
      return {...state, loading: false, errors: action.payload, updated: false};
    case StorageActionTypes.DELETE_REQUEST:
      return {...state, loading: true};
    case StorageActionTypes.DELETE_SUCCESS:
      return {...state, loading: false, errors: undefined};
    case StorageActionTypes.DELETE_ERROR:
      return {...state, loading: false, errors: action.payload};
    default:
      return state;
  }
}
