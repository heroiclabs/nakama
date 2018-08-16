<template>
  <div class="ui segment" :class="{'loading': loading}">
    <h3>Account Info</h3>
    <div class="ui two column grid" v-if="!loading">
      <div class="row">
        <div class="column">
          <table class="ui definition table">
            <tbody>
              <tr>
                <td>User ID</td>
                <td>{{account.user.id}}</td>
              </tr>
              <tr>
                <td>Username</td>
                <td>{{account.user.username}}</td>
              </tr>
              <tr>
                <td>Display Name</td>
                <td>{{account.user.display_name}}</td>
              </tr>
              <tr>
                <td>Avatar URL</td>
                <td>{{account.user.avatar_url}}</td>
              </tr>
              <tr>
                <td>Language Tag</td>
                <td>{{account.user.lang_tag}}</td>
              </tr>
              <tr>
                <td>Location</td>
                <td>{{account.user.location}}</td>
              </tr>
              <tr>
                <td>Timezone</td>
                <td>{{account.user.timezone}}</td>
              </tr>
              <tr>
                <td>Edge Count</td>
                <td>{{account.user.edge_count}}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="column">
          <table class="ui definition table">
            <tbody>
              <tr>
                <td>Email</td>
                <td>{{account.email}}</td>
              </tr>
              <tr>
                <td>Custom ID</td>
                <td>{{account.custom_id}}</td>
              </tr>
              <tr>
                <td>Facebook ID</td>
                <td>{{account.user.facebook_id}}</td>
              </tr>
              <tr>
                <td>Google ID</td>
                <td>{{account.user.google_id}}</td>
              </tr>
              <tr>
                <td>Gamecenter ID</td>
                <td>{{account.user.gamecenter_id}}</td>
              </tr>
              <tr>
                <td>Steam ID</td>
                <td>{{account.user.steam_id}}</td>
              </tr>
              <tr>
                <td>Create Time</td>
                <td>{{account.user.create_time}}</td>
              </tr>
              <tr>
                <td>Update Time</td>
                <td>{{account.user.update_time}}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="row">
        <div class="column">
          <h4 class="ui tiny header">Metadata</h4>
        </div>
        <div class="sixteen wide column ui input form">
          <textarea disabled style="width: 100%; height: 50px">{{account.user.metadata}}</textarea>
        </div>
      </div>
      <div class="row">
        <div class="column">
          <h4 class="ui tiny header">Wallet</h4>
        </div>
        <div class="sixteen wide column ui input form">
          <textarea disabled style="width: 100%; height: 50px">{{account.wallet}}</textarea>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import { Account } from '@/store/types';

export default Vue.extend({
  props: {
    id: String,
  },
  data: () => {
    return {
      loading: false,
    };
  },
  computed: {
    account(): Account {
      return this.$store.getters.currentAccount;
    },
  },
  methods: {
    async loadAccount(id: string): Promise<void> {
      this.loading = true;
      try {
        await this.$store.dispatch('loadAccount', id);
      } catch (error) {
        this.$emit('on-error', error);
      } finally {
        this.loading = false;
      }
    },
  },
  async created() {
    try {
      await this.loadAccount(this.id);
    } catch (error) {
      this.$emit('on-error', error);
    }
  },
});
</script>
