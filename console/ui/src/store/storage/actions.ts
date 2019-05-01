import {action} from 'typesafe-actions';
import {StorageActionTypes, StorageObjectRequest, StorageObject, Storages} from './types';

export const storageFetchManyRequest = (data: StorageObjectRequest) => action(
  StorageActionTypes.FETCH_MANY_REQUEST,
  data
);
export const storageFetchManySuccess = (data: Storages) => action(
  StorageActionTypes.FETCH_MANY_SUCCESS,
  data
);
export const storageFetchManyError = (message: string) => action(
  StorageActionTypes.FETCH_MANY_ERROR,
  message
);

export const storageDeleteManyRequest = () => action(
  StorageActionTypes.DELETE_MANY_REQUEST
);
export const storageDeleteManySuccess = () => action(
  StorageActionTypes.DELETE_MANY_SUCCESS
);
export const storageDeleteManyError = (message: string) => action(
  StorageActionTypes.DELETE_MANY_ERROR,
  message
);

export const storageCreateRequest = (data: StorageObject) => action(
  StorageActionTypes.CREATE_REQUEST,
  data
);
export const storageCreateSuccess = (data: StorageObject) => action(
  StorageActionTypes.CREATE_SUCCESS,
  data
);
export const storageCreateError = (message: string) => action(
  StorageActionTypes.CREATE_ERROR,
  message
);

export const storageFetchRequest = (data: StorageObjectRequest) => action(
  StorageActionTypes.FETCH_REQUEST,
  data
);
export const storageFetchSuccess = (data: StorageObject) => action(
  StorageActionTypes.FETCH_SUCCESS,
  data
);
export const storageFetchError = (message: string) => action(
  StorageActionTypes.FETCH_ERROR,
  message
);

export const storageUpdateRequest = (data: StorageObject) => action(
  StorageActionTypes.UPDATE_REQUEST,
  data
);
export const storageUpdateSuccess = () => action(
  StorageActionTypes.UPDATE_SUCCESS
);
export const storageUpdateError = (message: string) => action(
  StorageActionTypes.UPDATE_ERROR,
  message
);

export const storageDeleteRequest = (data: StorageObjectRequest) => action(
  StorageActionTypes.DELETE_REQUEST,
  data,
);
export const storageDeleteSuccess = () => action(
  StorageActionTypes.DELETE_SUCCESS
);
export const storageDeleteError = (message: string) => action(
  StorageActionTypes.DELETE_ERROR,
  message
);
