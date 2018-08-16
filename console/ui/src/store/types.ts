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
  create_time?: string;
  update_time?: string;
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

export interface Friend {
  state: number;
  user: User;
}

export interface Group {
  id: string;
  creator_id: string;
  name: string;
  description: string;
  lang_tag: string;
  metadata: string;
  avatar_url: string;
  open: boolean;
  edge_count: number;
  max_count: number;
  create_time: string;
  update_time: string;
}

export interface UserGroup {
  state: number;
  group: Group;
}

export interface AccountState {
  currentAccount: Account[]; // has to be a list so that vuex notifies on change.
  friends: Friend[];
  groups: UserGroup[];
}

export interface AccountsState {
  accounts: Account[];
}

export interface MainState {
  credentials?: Credentials;
}

