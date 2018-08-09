import {GetterTree} from 'vuex';
import { State } from './types';

const getters: GetterTree<State, any> = {
  isAuthenticated: (state: State) => {
    return state.token !== '';
  },
};

export default getters;
