export interface User {
  id: string;
  username?: string;
  display_name?: string;
  avatar_url?: string;
  lang_tag?: string;
  location?: string;
  timezone?: string;
  metadata?: string;
  facebook_id?: string;
  google_id?: string;
  gamecenter_id?: string;
  steam_id?: string;
  edge_count?: number;
  create_time?: number;
  update_time?: number;
}

export interface Account {
  user: User;
  wallet?: string;
  email?: string;
  devices?: string[];
  custom_id?: string;
  verify_time?: number;
}

export interface Credentials {
  username: string;
  password: string;
}

export interface UsersState {
  accounts: Account[];
}

export interface MainState {
  credentials?: Credentials;
}

