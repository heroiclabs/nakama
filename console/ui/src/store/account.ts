import Vue from 'vue';
import Vuex from 'vuex';
import { Store, ActionTree, ActionContext, GetterTree } from 'vuex';
import axios from 'axios';

import { AccountState, Credentials, Account, Friend, UserGroup } from './types';

Vue.use(Vuex);

const mutations = {
  currentAccount(state: AccountState, account: Account[]) {
    state.currentAccount = account;
  },
  friends(state: AccountState, friends: Friend[]) {
    state.friends = friends === undefined ? [] : friends;
  },
  groups(state: AccountState, groups: UserGroup[]) {
    state.groups = groups === undefined ? [] : groups;
  },
};

const actions: ActionTree<AccountState, any> = {
  loadAccount: async (store: ActionContext<AccountState, any>, userId: string) => {
    try {
      const response = await axios.get('/v2/console/account/' + userId, {auth: store.getters.credentials});
      store.commit('currentAccount', [response.data]);
    } catch (error) {
      store.commit('currentAccount', []);
      return Promise.reject(error);
    }
  },
  loadFriends: async (store: ActionContext<AccountState, any>, userId: string) => {
    try {
      const url = '/v2/console/account/' + userId + '/friends';
      const response = await axios.get(url, {auth: store.getters.credentials});
      store.commit('friends', response.data.friends);
    } catch (error) {
      store.commit('friends', []);
      return Promise.reject(error);
    }
  },
  loadGroups: async (store: ActionContext<AccountState, any>, userId: string) => {
    try {
      const url = '/v2/console/account/' + userId + '/groups';
      const response = await axios.get(url, {auth: store.getters.credentials});
      store.commit('groups', response.data.user_groups);
    } catch (error) {
      store.commit('groups', []);
      return Promise.reject(error);
    }
  },
};

const getters: GetterTree<AccountState, any> = {
  currentAccount: (state: AccountState) => {
    return state.currentAccount[0];
  },
  friends: (state: AccountState) => {
    return state.friends;
  },
  groups: (state: AccountState) => {
    return state.groups;
  },
};

const accountState: AccountState = {
  currentAccount: [],
  friends: [],
  groups: [],
};

export default {
  state: accountState,
  mutations,
  actions,
  getters,
};
