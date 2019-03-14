export interface Warning
{
  field: string,
  message: string
};

export interface Metrics
{
  reporting_freq_sec?: number,
  namespace?: string,
  stackdriver_projectid?: string,
  prometheus_port?: number
};

export interface Logger
{
  stdout?: boolean,
  level?: string,
  file?: string
};

export interface Database
{
  address?: string[],
  conn_max_lifetime_ms?: number
};

export interface Runtime
{
  env?: string[],
  path?: string,
  http_key?: string
};

export interface Socket
{
  server_key?: string,
  port?: number,
  max_message_size_bytes?: number
};

export interface ConfigDetails
{
  name?: string,
  data_dir?: string,
  logger?: Logger,
  metrics?: Metrics,
  database?: Database,
  runtime?: Runtime,
  socket?: Socket
};

export interface Config
{
  config: ConfigDetails,
  warnings?: Warning[],
  server_version ?: string,
};

export enum ConfigurationActionTypes
{
  FETCH_REQUEST = '@@configuration/FETCH_REQUEST',
  FETCH_SUCCESS = '@@configuration/FETCH_SUCCESS',
  FETCH_ERROR = '@@configuration/FETCH_ERROR'
};

export interface ConfigurationState
{
  readonly loading: boolean,
  readonly data: Config,
  readonly errors?: string
};
