import React from 'react';
import ReactDOM from 'react-dom';

import {applyMiddleware, createStore} from 'redux';
import {Provider} from 'react-redux';
import createSagaMiddleware from 'redux-saga';
import {createRootReducer, rootSaga} from './store';

import {HashRouter as Router, Switch, Route} from 'react-router-dom';
import * as serviceWorker from './serviceWorker';
import {NakamaApi} from './api.gen';

import {library} from '@fortawesome/fontawesome-svg-core';
import {
  faAngleDown,
  faBan,
  faFile,
  faFileCsv,
  faFileExport,
  faLink,
  faSignOutAlt,
  faTrash,
  faUsersCog
} from '@fortawesome/free-solid-svg-icons';

import Index from './routes/index';
import Login from './routes/login';
import Status from './routes/status';
import Configuration from './routes/configuration';
import Users from './routes/users';
import UsersDetails from './routes/users/details';
import Storage from './routes/storage';
import StorageDetails from './routes/storage/details';

import 'rbx/index.css';
import './css/index.css';

declare global {
  interface Window {
    nakama_api: any;
  }
}

library.add(
  faAngleDown,
  faBan,
  faFile,
  faFileCsv,
  faFileExport,
  faLink,
  faSignOutAlt,
  faTrash,
  faUsersCog
);

const sagaMiddleware = createSagaMiddleware();
const store = createStore(
  createRootReducer(),
  {},
  applyMiddleware(sagaMiddleware)
);
sagaMiddleware.run(rootSaga);

const state = store.getState();
window.nakama_api = NakamaApi({
  basePath: process.env.REACT_APP_BASE_PATH || window.location.origin,
  bearerToken: (
    state &&
    state.login &&
    state.login.data &&
    state.login.data.token
  ) || localStorage.getItem('token') || '',
  timeoutMs: 5000
});

ReactDOM.render(
  <Provider store={store}>
    <Router>
      <Switch>
        <Route path="/storage/:collection/:key/:user_id" component={StorageDetails}/>
        <Route path="/storage" component={Storage}/>
        <Route path="/users/:id" component={UsersDetails}/>
        <Route path="/users" component={Users}/>
        <Route path="/configuration" component={Configuration}/>
        <Route path="/status" component={Status}/>
        <Route path="/login" component={Login}/>
        <Route path="/" component={Index}/>
      </Switch>
    </Router>
  </Provider>,
  document.getElementById('root')
);
serviceWorker.unregister();
