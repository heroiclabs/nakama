export interface StorageObjectRequest
{
  collection?: string,
  key?: string,
  user_id?: string,
  filter?: string
}

export interface StorageObject
{
  collection: string,
  key: string,
  user_id: string,
  value: string,
  version: string,
  permission_read: number,
  permission_write: number,
  create_time?: string,
  update_time?: string
};

export interface Storages
{
  objects: StorageObject[],
  total_count: number
};

export enum StorageActionTypes
{
  FETCH_MANY_REQUEST = '@@storage/FETCH_MANY_REQUEST',
  FETCH_MANY_SUCCESS = '@@storage/FETCH_MANY_SUCCESS',
  FETCH_MANY_ERROR = '@@storage/FETCH_MANY_ERROR',
  DELETE_MANY_REQUEST = '@@storage/DELETE_MANY_REQUEST',
  DELETE_MANY_SUCCESS = '@@storage/DELETE_MANY_SUCCESS',
  DELETE_MANY_ERROR = '@@storage/DELETE_MANY_ERROR',
  CREATE_REQUEST = '@@storage/CREATE_REQUEST',
  CREATE_SUCCESS = '@@storage/CREATE_SUCCESS',
  CREATE_ERROR = '@@storage/CREATE_ERROR',
  FETCH_REQUEST = '@@storage/FETCH_REQUEST',
  FETCH_SUCCESS = '@@storage/FETCH_SUCCESS',
  FETCH_ERROR = '@@storage/FETCH_ERROR',
  UPDATE_REQUEST = '@@storage/UPDATE_REQUEST',
  UPDATE_SUCCESS = '@@storage/UPDATE_SUCCESS',
  UPDATE_ERROR = '@@storage/UPDATE_ERROR',
  DELETE_REQUEST = '@@storage/DELETE_REQUEST',
  DELETE_SUCCESS = '@@storage/DELETE_SUCCESS',
  DELETE_ERROR = '@@storage/DELETE_ERROR'
};

export interface StoragesState
{
  readonly loading: boolean,
  readonly data: Storages,
  readonly errors?: string
};

export interface StorageState
{
  readonly loading: boolean,
  readonly updated: boolean,
  readonly data: StorageObject,
  readonly errors?: string
};
