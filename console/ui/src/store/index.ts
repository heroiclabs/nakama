import Vue from 'vue';
import Vuex from 'vuex';
import { Store } from 'vuex';

import State from './state';
import Getters from './getters';
import Mutations from './mutations';
import Actions from './actions';

Vue.use(Vuex);

export default new Vuex.Store({
  state: State,
  getters: Getters,
  mutations: Mutations,
  actions: Actions,
});
