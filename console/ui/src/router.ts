import Vue from 'vue';
import Router from 'vue-router';
import store from './store/main';
import Login from './views/Login.vue';
import Status from './views/Status.vue';
import AccountList from './views/AccountList.vue';
import Account from './views/Account.vue';
import Storage from './views/Storage.vue';

Vue.use(Router);

const router = new Router({
  routes: [
    {
      path: '/login',
      component: Login,
    },
    {
      path: '/',
      name: '/',
      redirect: '/accounts',
    },
    // {
    //   path: '/status',
    //   name: 'status',
    //   component: Status,
    // },
    {
      path: '/accounts',
      name: 'accounts',
      component: AccountList,
    },
    {
      path: '/accounts/:id',
      name: 'account',
      component: Account,
      props: true,
    },
    // {
    //   path: '/storage',
    //   name: 'storage',
    //   component: Storage,
    // },
    // {
    //   path: '/config',
    //   name: 'config',
    //   component: Config,
    // },
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
