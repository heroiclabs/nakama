import {ActionTree, ActionContext, GetterTree} from 'vuex';
import axios from 'axios';
import { State, Credentials } from './types';

const actions: ActionTree<State, any> = {
  authenticate: (store: ActionContext<State, any>, credentials: Credentials) => {
    return axios.post('/v2/console/authenticate', credentials)
    .then((response) => {
      store.commit('authenticate', credentials);
    });
  },
};

export default actions;
