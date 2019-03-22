import React from 'react';
import ReactDOM from 'react-dom';

import {createStore} from 'redux';
import {Provider} from 'react-redux';
import Reducers from './reducers';

import {BrowserRouter as Router, Switch, Route} from 'react-router-dom';
import {library} from '@fortawesome/fontawesome-svg-core';
import {faSignOutAlt, faFileExport, faTrash, faUsersCog, faAngleDown, faFile, faFileCsv} from '@fortawesome/free-solid-svg-icons';

import * as serviceWorker from './serviceWorker';

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

library.add(faSignOutAlt, faFileExport, faTrash, faUsersCog, faAngleDown, faFile, faFileCsv);

ReactDOM.render(
  <Provider store={createStore(Reducers)}>
    <Router>
      <Switch>
        <Route path="/storage/:id" component={StorageDetails} />
        <Route path="/storage" component={Storage} />
        <Route path="/users/:id" component={UsersDetails} />
        <Route path="/users" component={Users} />
        <Route path="/configuration" component={Configuration} />
        <Route path="/status" component={Status} />
        <Route path="/login" component={Login} />
        <Route path="/" component={Index} />
      </Switch>
    </Router>
  </Provider>,
  document.getElementById('root')
);
serviceWorker.unregister();
