import Vue from 'vue';
import Router from 'vue-router';
import store from './store/index';
import Login from './views/Login.vue';
import Home from './views/Home.vue';
import Users from './views/Users.vue';
import Storage from './views/Storage.vue';

Vue.use(Router);

const router = new Router({
  routes: [
    {
      path: '/login',
      name: 'login',
      component: Login,
    },
    {
      path: '/',
      name: 'home',
      component: Home,
    },
    {
      path: '/users',
      name: 'users',
      component: Users,
    },
    {
      path: '/storage',
      name: 'storage',
      component: Storage,
    },
  ],
});

router.beforeEach((to, from, next) => {
  if (!store.getters.isAuthenticated) {
    if (to.path !== '/login') {
      next('/login');
    } else {
      next();
    }
  } else {
    if (to.path === '/login') {
      next('/');
    } else {
      next();
    }
  }
});

export default router;
