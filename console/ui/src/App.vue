<template>
  <div v-if="!isAuthenticated" id="app" class="fullheight">
    <!-- login view -->
    <router-view/>
  </div>
  <div v-else id="app">
    <Sidebar/>
    <section class="pusher">
      <div class="ui basic segment">
        <router-view/>
      </div>
    </section>
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

.pusher {
  min-width: 500px;
  margin-left: 200px;
}
</style>
