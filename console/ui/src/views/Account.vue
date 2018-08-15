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

    <AccountInfo v-bind:id="id" @on-error="onError"/>
    <!-- <AccountFriends v-bind:id="id" @on-error="onError"/>
    <AccountGroups v-bind:id="id" @on-error="onError"/> -->
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import AccountInfo from '@/components/AccountInfo.vue';

export default Vue.extend({
  components: {
    AccountInfo,
    // AccountFriends,
    // AccountGroups,
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
});
</script>
