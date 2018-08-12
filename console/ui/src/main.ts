import 'semantic-ui-css/semantic.min.css';
import Vue from 'vue';
import VeeValidate from 'vee-validate';
import axios from 'axios';
import App from './App.vue';
import store from './store/main';
import router from './router';

Vue.config.productionTip = false;
Vue.use(VeeValidate, {errorBagName: 'vee'});

axios.defaults.timeout = 2500;
axios.defaults.baseURL = window.location.origin;
if (process.env.NODE_ENV === 'development') {
  axios.defaults.baseURL = window.location.protocol + '//' + window.location.hostname + ':7351';
}

/* tslint:disable:no-console */
axios.interceptors.response.use((response) => {
  return response;
}, (error) => {
  if (error.response) {
    // Received non-200 response...
    console.error('Received HTTP response error: %o', error.response);
  } else if (error.request) {
    console.error('Could not send request - is the server running? %o', error.request);
  } else {
    console.log('Unknown error occured: %o', error.message);
  }
  return Promise.reject(error);
});
/* tslint:enable:no-console */

new Vue({
  router,
  store,
  render: (h) => h(App),
}).$mount('#app');
