import Vue from 'vue';
import Vuex from 'vuex';
import { Store, ActionTree, ActionContext, GetterTree } from 'vuex';
import axios from 'axios';

import { AccountState, Credentials, Account } from './types';

Vue.use(Vuex);

const mutations = {
  currentAccount(state: AccountState, account?: Account) {
    state.currentAccount = [account];
  },
};

const actions: ActionTree<AccountState, any> = {
  loadAccount: async (store: ActionContext<AccountState, any>, userId: string) => {
    try {
      const response = await axios.get('/v2/console/account/' + userId, {auth: store.getters.credentials});
      store.commit('currentAccount', response.data);
    } catch (error) {
      store.commit('currentAccount', undefined);
      return Promise.reject(error);
    }
  },
};

const getters: GetterTree<AccountState, any> = {
  currentAccount: (state: AccountState) => {
    return state.currentAccount[0];
  },
};

const accountState: AccountState = {
  currentAccount: [],
};
export default {
  state: accountState,
  mutations,
  actions,
  getters,
};
