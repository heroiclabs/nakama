<template>
  <div id="app" :class="{fullheight: !isAuthenticated}">
    <div class="fullheight" v-if="!isAuthenticated">
      <!-- login view -->
      <router-view/>
    </div>
    <template v-else>
      <div class="ui grid">
        <div class="doubling sixteen column row no-gutter-bottom">
          <div class="two wide column">
            <Sidebar/>
          </div>
          <div class="fourteen wide column no-gutter-left">
            <router-view/>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import Sidebar from './components/Sidebar.vue';

export default Vue.extend({
  components: {
    Sidebar,
  },
  computed: {
    isAuthenticated(): boolean {
      return this.$store.getters.isAuthenticated;
    },
  },
});
</script>

<style>
body {
  background-color: #F0F4F8;
}

#app {
  font-family: 'Avenir', Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #2c3e50;
}

.fullheight {
  height: 100%;
}

.no-gutter-left {
  padding-left: 0px !important;
}

.no-gutter-bottom {
  padding-bottom: 0px !important;
}

#nav {
  padding: 30px;
}

#nav a {
  font-weight: bold;
  color: #2c3e50;
}
</style>
