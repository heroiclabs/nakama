<template>
  <div class="ui bottom attached segment" :class="{'loading': isLoading}">
    <table class="ui compact celled table unstackable" :class="{definition: accounts.length > 0}">
      <thead>
        <tr>
          <th v-if="accounts.length > 0"></th>
          <th>User ID</th>
          <th>Username</th>
          <th>Display Name</th>
          <th>Email</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="accounts.length == 0">
          <td>No users found.</td>
        </tr>
        <tr v-for="account in accounts">
          <td class="collapsing">
            <button @click="deleteAccount(account.user.id)" class="ui compact fluid icon button">
              <i class="icon trash"></i>
            </button>
          </td>
          <td><router-link :to="'/accounts/'+account.user.id">{{account.user.id}}</router-link></td>
          <td>{{account.user.username}}</td>
          <td>{{account.user.display_name ? account.user.display_name : '-'}}</td>
          <td>{{account.email ? account.email : '-'}}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import { Account } from '@/store/types';

export default Vue.extend({
  props: {
    loading: Boolean,
  },
  data: () => {
    return {
      deleting: false,
    };
  },
  computed: {
    accounts(): Account[] {
      return this.$store.getters.accounts;
    },
    isLoading(): boolean {
      return this.loading || this.deleting;
    },
  },
  methods: {
    async deleteAccount(userId: string): Promise<void> {
      this.deleting = true;
      try {
        await this.$store.dispatch('deleteAccount', userId);
      } catch (error) {
        this.$emit('on-error', error);
      } finally {
        this.deleting = false;
      }
    },
  },
});
</script>
