<template>
  <form id="login" @submit.prevent="login" class="ui form">
    <div v-if="error !== ''" class="ui floating tiny left icon message">
      <i class="exclamation icon"></i>
      <div class="content">
        <div class="header">
          Authentication failed!
        </div>
      </div>
    </div>
    <div class="ui stacked segment">
      <div class="field">
        <div class="ui input">
          <input type="text" name="username" id="username" v-model="username" v-validate="'required'" placeholder="Username" autofocus>
        </div>
      </div>
      <div class="field">
        <div class="ui input">
          <input type="password" name="password" id="password" v-model="password" v-validate="'required'" placeholder="Password">
        </div>
      </div>
      <button type="submit" class="ui fluid submit button primary" :class="{disabled: isFormPristine || vee.any() || loading, loading: loading}">Login</button>
    </div>
  </form>
</template>

<script lang="ts">
import Vue from 'vue';
import { Credentials } from '@/store/types';
import { Validator, VeeValidateComponentOptions, Field } from 'vee-validate';

export default Vue.extend({
  data() {
    return {
      isAuthenticated: this.$store.getters.isAuthenticated,
      loading: false,
      error: '',
      username: '',
      password: '',
    };
  },
  computed: {
    isFormPristine(): boolean {
      return Object.keys(this.$validator.fields.items).some((key) => {
        return this.$validator.fields.items[parseInt(key, 10)].flags.pristine;
      });
    },
  },
  methods: {
    login() {
      this.loading = true;
      this.error = '';
      const credentials: Credentials = {
        username: this.username,
        password: this.password,
      };
      this.$store.dispatch('authenticate', credentials).then(() => {
        this.loading = false;
        this.$router.replace({path: '/'});
      }).catch((error) => {
        this.loading = false;
        this.error = error.response.data.error;
      });
    },
  },
});
</script>

<style scoped>
h3 {
  margin: 40px 0 0;
}
ul {
  list-style-type: none;
  padding: 0;
}
li {
  display: inline-block;
  margin: 0 10px;
}
a {
  color: #42b983;
}
.left {
  text-align: left;
}
</style>
