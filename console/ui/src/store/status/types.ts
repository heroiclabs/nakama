export interface Node
{
  name: string,
  session_count?: number,
  presence_count?: number,
  match_count?: number,
  goroutine_count?: number,
  avg_latency_ms: number,
  avg_rate_sec: number,
  avg_input_kbs: number,
  avg_output_kbs: number
};

export interface StatusNodes
{
  nodes: Node[]
};

export enum StatusActionTypes
{
  FETCH_REQUEST = '@@status/FETCH_REQUEST',
  FETCH_SUCCESS = '@@status/FETCH_SUCCESS',
  FETCH_ERROR = '@@status/FETCH_ERROR'
};

export interface StatusState
{
  readonly loading: boolean,
  readonly data: StatusNodes,
  readonly errors?: string
};
