<template>
  <div class="users">
    <h2>Users</h2>
    <div v-if="error !== ''" class="ui floating mini left icon message">
      <i class="exclamation icon"></i>
      <div class="content">
        <div class="header">
          Unexpected error occured - {{error}}
        </div>
      </div>
    </div>
    <div class="ui top attached menu">
      <div class="item">
        <button @click="searchOrListUsers()" class="ui compact fluid icon button"><i class="icon refresh"></i></button>
      </div>
      <div class="ui category search item">
        <div class="ui transparent icon input">
          <input @keyup.enter="searchOrListUsers()" v-model="userId" class="prompt" type="text" minlength="36" maxlength="36" style="width: 400px" placeholder="Look up user ID...">
          <i @click="searchOrListUsers()" class="search link icon"></i>
        </div>
      </div>
      <div class="right item">
        <button @click="deleteAllUsers()" class="ui compact button"><i class="icon exclamation triangle"></i> Delete all users</button>
      </div>
    </div>

    <UsersTable v-bind:loading="loading"/>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import { UsersState } from '@/store/types';
import UsersTable from '@/components/UsersTable.vue';

export default Vue.extend({
  components: {
    UsersTable,
  },
  data: () => {
    return {
      error: '',
      loading: false,
      userId: '', // value is initiated if one exists in the store
    };
  },
  methods: {
    async searchOrListUsers(): Promise<void> {
      this.error = '';

      this.loading = true;
      try {
        if (this.userId === '') {
          await this.$store.dispatch('listUsers');
        } else {
          await this.$store.dispatch('searchUsers', this.userId);
        }
      } catch (error) {
        this.error = error.response.data.error;
      } finally {
        this.loading = false;
      }
    },
    async deleteAllUsers(): Promise<void> {
      this.error = '';

      try {
        this.loading = true;
        await this.$store.dispatch('deleteAllUsers');
      } catch (error) {
        this.error = error.response.data.error;
      } finally {
        this.loading = false;
      }
    },
  },
  created() {
    // this.userId = this.$store.getters.userId;
    this.searchOrListUsers();
  },
});
</script>
