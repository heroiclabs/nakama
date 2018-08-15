<template>
  <div>
    <h2>Accounts</h2>
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
        <button @click="searchOrListAccounts()" class="ui compact fluid icon button"><i class="icon refresh"></i></button>
      </div>
      <div class="ui category search item">
        <div class="ui transparent icon input">
          <input @keyup.enter="searchOrListAccounts()" v-model="userId" class="prompt" type="text" minlength="36" maxlength="36" style="width: 400px" placeholder="Look up user ID...">
          <i @click="searchOrListAccounts()" class="search link icon"></i>
        </div>
      </div>
      <div class="right item">
        <button @click="deleteAllAccounts()" class="ui compact button"><i class="icon exclamation triangle"></i> Delete all accounts</button>
      </div>
    </div>

    <AccountsTable v-bind:loading="loading" @on-error="onError"/>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import { AccountsState } from '@/store/types';
import AccountsTable from '@/components/AccountsTable.vue';

export default Vue.extend({
  components: {
    AccountsTable,
  },
  data: () => {
    return {
      error: '',
      loading: false,
      userId: '', // value is initiated if one exists in the store
    };
  },
  methods: {
    onError(error: any) {
      this.error = error.response.data.error;
    },
    async searchOrListAccounts(): Promise<void> {
      this.error = '';

      this.loading = true;
      try {
        if (this.userId === '') {
          await this.$store.dispatch('listAccounts');
        } else {
          await this.$store.dispatch('searchAccounts', this.userId);
        }
      } catch (error) {
        this.onError(error);
      } finally {
        this.loading = false;
      }
    },
    async deleteAllAccounts(): Promise<void> {
      this.error = '';

      try {
        this.loading = true;
        await this.$store.dispatch('deleteAllAccounts');
      } catch (error) {
        this.onError(error);
      } finally {
        this.loading = false;
      }
    },
  },
  created() {
    this.searchOrListAccounts();
  },
});
</script>
