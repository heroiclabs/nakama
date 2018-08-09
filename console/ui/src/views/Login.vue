<template>
  <section class="login fullheight ui middle aligned center aligned grid">
    <div class="column">
      <img src="../assets/nakama_logo.png" class="logo" />
      <h2 class="ui header">Developer Console</h2>
      <LoginBox/>
      <div>
        <br />
        <a target="_blank" href="https://heroiclabs.com">Website</a> &nbsp;&centerdot;&nbsp;
        <a target="_blank" href="https://heroiclabs.com/docs">Documentation</a> &nbsp;&centerdot;&nbsp;
        <a target="_blank" href="https://github.com/heroiclabs/nakama">GitHub</a>
      </div>
      <p style="padding-top: 20px;">Made with ❤ by <img src="../assets/heroiclabs_logo.png" class="logo heroiclabs" /></p>
    </div>
  </section>
</template>

<script lang="ts">
import { Component, Vue } from 'vue-property-decorator';
import LoginBox from '@/components/LoginBox.vue';

export default Vue.extend({
  components: {
    LoginBox,
  },
});
</script>

<style scoped>
#app, body > .grid {
  height: 100%;
}

.column {
  max-width: 450px;
  text-align: center;
}

.logo {
  max-width: 100px;
  vertical-align: middle;
}

.heroiclabs {
  max-width: 100px;
}
</style>
