<template>
  <div>
    <h2>Account - {{id}}</h2>
    <div v-if="error !== ''" class="ui floating mini left icon message">
      <i class="exclamation icon"></i>
      <div class="content">
        <div class="header">
          Unexpected error occured - {{error}}
        </div>
      </div>
    </div>

    <AccountInfo ref="accountInfo" v-bind:id="id" @on-error="onError"/>
    <AccountFriends ref="friends" v-bind:id="id" @on-error="onError"/>
    <AccountGroups ref="groups" v-bind:id="id" @on-error="onError"/>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import AccountInfo from '@/components/AccountInfo.vue';
import AccountFriends from '@/components/AccountFriends.vue';
import AccountGroups from '@/components/AccountGroups.vue';

export default Vue.extend({
  components: {
    AccountInfo,
    AccountFriends,
    AccountGroups,
  },
  props: {
    id: String,
  },
  data: () => {
    return {
      error: '',
    };
  },
  methods: {
    onError(error: any) {
      this.error = error.response.data.error;
    },
  },
  async beforeRouteUpdate(to, from, next) {
    try {
      await (this.$refs.accountInfo as any).loadAccount(to.params.id);
      await (this.$refs.friends as any).loadFriends(to.params.id);
      await (this.$refs.groups as any).loadGroups(to.params.id);
      next();
    } catch (error) {
      this.$emit('on-error', error);
    }
  },
});
</script>
