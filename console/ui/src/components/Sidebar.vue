<template>
  <div class="ui large fluid vertical attached menu labeled icon inverted blue" style="height: 100vh">
    <div class="item"><img src="@/assets/nakama_logo_small.png" class="logo"></div>
    <router-link class="item" exact-active-class="active" to="/"><i class="home icon"></i> Home</router-link>
    <router-link class="item" exact-active-class="active" to="/users"><i class="users icon"></i>Users</router-link>
    <router-link class="item" exact-active-class="active" to="/storage"><i class="database icon"></i>Storage</router-link>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
  data() {
    return {
    };
  },
  methods: {
  },
});
</script>

<style scoped>
.active {
  background-color: rgba(0,0,0,0.3)!important;
}
.logo {
  width: 40px !important;
  margin: 0 auto !important;
}
</style>
