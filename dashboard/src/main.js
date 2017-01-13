// Copyright 2017 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// The Vue build version to load with the `import` command
// (runtime-only or standalone) has been set in webpack.base.conf with an alias.

import 'element-ui/lib/theme-default/index.css';
import locale from 'element-ui/lib/locale/lang/en';

import Cluster from 'components/Cluster';
import Config from 'components/Config';

import ElementUI from 'element-ui';
import VueRouter from 'vue-router';

import Vue from 'vue';
import App from './App';

Vue.use(VueRouter);
Vue.use(ElementUI, { locale });

const router = new VueRouter({
  routes: [
    { path: '/', component: Cluster },
    { path: '/config', component: Config },
  ],
});

/* eslint-disable no-new */
new Vue({
  router,
  el: '#app',
  render: h => h(App),
});
