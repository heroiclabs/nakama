<template>
  <nav class="ui large sidebar menu vertical left visible blue inverted">
    <div class="item"><img src="@/assets/nakama_logo_small.png" class="logo"></div>
    <router-link class="item" exact-active-class="active" to="/"><i class="home icon"></i> Home</router-link>
    <router-link class="item" exact-active-class="active" to="/users"><i class="users icon"></i>Users</router-link>
    <router-link class="item" exact-active-class="active" to="/storage"><i class="database icon"></i>Storage</router-link>
    <br/>
    <a class="ui item sub tiny header" href="https://heroiclabs.com/docs" target="_blank">Documentation</a>
    <a class="ui item sub tiny header" href="https://gitter.im/heroiclabs/nakama" target="_blank">Community</a>
    <a class="ui item sub tiny header" href="https://heroiclabs.com/services" target="_blank">Heroic Support</a>
    <br />
    <div class="ui item sub tiny inverted grey header">
      <p>Nakama 2.0.3</p>
    </div>
  </nav>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({});
</script>

<style scoped>
.active {
  background-color: rgba(0,0,0,0.3) !important;
}

.logo {
  width: 40px !important;
  margin: 0 auto !important;
}

.ui.left.sidebar {
  width: 200px;
}
</style>
