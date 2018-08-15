import Vue from 'vue';
import Vuex from 'vuex';
import { Store, ActionTree, ActionContext, GetterTree } from 'vuex';
import axios from 'axios';

import { AccountsState, Credentials, Account } from './types';

Vue.use(Vuex);

const mutations = {
  accounts(state: AccountsState, accounts?: Account[]) {
    state.accounts = accounts === undefined ? [] : accounts;
  },
};

const actions: ActionTree<AccountsState, any> = {
  searchAccounts: async (store: ActionContext<AccountsState, any>, userId: string) => {
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
  listAccounts: async (store: ActionContext<AccountsState, any>) => {
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
  deleteAccount: async (store: ActionContext<AccountsState, any>, userId: string) => {
    await axios.delete('/v2/console/account/' + userId, {auth: store.getters.credentials});
    const newAccounts = store.getters.accounts.filter((account: Account) => account.user.id !== userId);
    store.commit('accounts', newAccounts);
  },
  deleteAllAccounts: async (store: ActionContext<AccountsState, any>) => {
    await axios.delete('/v2/console/account', {auth: store.getters.credentials});
    store.commit('accounts', []);
  },
};

const getters: GetterTree<AccountsState, any> = {
  accounts: (state: AccountsState) => {
    return state.accounts;
  },
};

const accountsState: AccountsState = {
  accounts: [],
};

export default {
  state: accountsState,
  mutations,
  actions,
  getters,
};
