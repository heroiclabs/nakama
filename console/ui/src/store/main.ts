import Vue from 'vue';
import Vuex from 'vuex';
import { Store, ActionTree, ActionContext, GetterTree } from 'vuex';
import axios from 'axios';

import { MainState, Credentials } from './types';
import Account from './account';
import Accounts from './accounts';

Vue.use(Vuex);

const mutations = {
  authenticate(state: MainState, credentials: Credentials) {
    state.credentials = credentials;
  },
};

const actions: ActionTree<MainState, any> = {
  authenticate: (store: ActionContext<MainState, any>, credentials: Credentials) => {
    return axios.post('/v2/console/authenticate', credentials)
    .then((response) => {
      store.commit('authenticate', credentials);
    });
  },
};

const getters: GetterTree<MainState, any> = {
  isAuthenticated: (state: MainState) => {
    return state.credentials !== undefined;
  },
  credentials: (state: MainState) => {
    return state.credentials;
  },
};

const mainState: MainState = {
  credentials: {username: 'admin', password: 'password'},
};

export default new Vuex.Store<MainState>({
  state: mainState,
  mutations,
  actions,
  getters,
  modules: {
    Account,
    Accounts,
  },
});
