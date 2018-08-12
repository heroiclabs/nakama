import Vue from 'vue';
import Vuex from 'vuex';
import { Store, ActionTree, ActionContext, GetterTree } from 'vuex';
import axios from 'axios';

import { UsersState, Credentials, Account } from './types';

Vue.use(Vuex);

const mutations = {
  accounts(state: UsersState, accounts?: Account[]) {
    state.accounts = accounts === undefined ? [] : accounts;
  },
};

const actions: ActionTree<UsersState, any> = {
  searchUsers: async (store: ActionContext<UsersState, any>, userId: string) => {
    try {
      const response = await axios.get('/v2/console/account/' + userId, {auth: store.getters.credentials});
      store.commit('accounts', [response.data]);
    } catch (error) {
      store.commit('accounts', []);
      if (error.response.status !== 404) {
        return Promise.reject(error);
      }
    }
  },
  listUsers: async (store: ActionContext<UsersState, any>) => {
    try {
      const response = await axios.get('/v2/console/account', {auth: store.getters.credentials});
      store.commit('accounts', response.data.accounts);
    } catch (error) {
      store.commit('accounts', []);
      if (error.response.status !== 404) {
        return Promise.reject(error);
      }
    }
  },
  deleteUser: async (store: ActionContext<UsersState, any>, userId: string) => {
    await axios.delete('/v2/console/account/' + userId, {auth: store.getters.credentials});
    const newAccounts = store.getters.accounts.filter((account: Account) => account.user.id !== userId);
    store.commit('accounts', newAccounts);
  },
  deleteAllUsers: async (store: ActionContext<UsersState, any>) => {
    await axios.delete('/v2/console/account', {auth: store.getters.credentials});
    store.commit('accounts', []);
  },
};

const getters: GetterTree<UsersState, any> = {
  accounts: (state: UsersState) => {
    return state.accounts;
  },
};

const usersState: UsersState = {
  accounts: [],
};

export default {
  state: usersState,
  mutations,
  actions,
  getters,
};
