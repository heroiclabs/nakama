<template>
  <div id="app">
    <template v-if="!isAuthenticated">
      <!-- login view -->
      <router-view/>
    </template>
    <template v-else>
      <section class="ui segment bottom attached pushable">
        <Sidebar/>
        <div class="pusher">
          <div class="ui basic segment">
            <router-view/>
          </div>
        </div>
      </section>
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
  height: 100%;
}

.pusher {
  -webkit-transform: translate3d(200px,0,0) !important;
  transform: translate3d(200px,0,0) !important;
}
</style>
