import { State, Credentials } from './types';

const mutations = {
  authenticate(state: State, credentials: Credentials) {
    state.token = btoa(credentials.username + ':' + credentials.password);
  },
};

export default mutations;
