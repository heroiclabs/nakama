<template>
  <div id="app">
    <topbar></topbar>
    <div style="margin-top: 10px;">
    </div>
    <router-view></router-view>
  </div>
</template>

<script>
import Topbar from './components/Topbar';

import Cluster from './components/Cluster';
import ClusterTable from './components/ClusterTable';
import DatabaseTable from './components/DatabaseTable';

import Config from './components/Config';
import ConfigViewer from './components/ConfigViewer';

export default {
  name: 'app',
  components: {
    Topbar,
    Cluster,
    ClusterTable,
    DatabaseTable,
    Config,
    ConfigViewer,
  },
};
</script>
