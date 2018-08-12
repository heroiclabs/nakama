import Vue from 'vue';
import Router from 'vue-router';
import store from './store/main';
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
      // component: Home,
      redirect: '/users',
    },
    // {
    //   path: '/config',
    //   name: 'config',
    //   component: Config,
    // },
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
    // {
    //   path: '/leaderboards',
    //   name: 'leaderboards',
    //   component: Leaderboards,
    // },
    // {
    //   path: '/tournaments',
    //   name: 'tournaments',
    //   component: Tournaments,
    // },
    // {
    //   path: '/runtime',
    //   name: 'runtime',
    //   component: Runtime,
    // },
    // {
    //   path: '/logs',
    //   name: 'logs',
    //   component: Logs,
    // },
    // {
    //   path: '/apidebugger',
    //   name: 'apidebugger',
    //   component: Apidebugger,
    // }
  ],
});

router.beforeEach((to, from, next) => {
  if (!to.matched.length) {
    // redirect 404 to homepage.
    next('/');
    return;
  }

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
