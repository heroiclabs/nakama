<template>
  <div class="ui segment" :class="{'loading': loading}">
    <h3>Friends</h3>
    <div class="ui two column grid" v-if="!loading">
      <div class="row">
        <div class="column">
          <table class="ui table">
            <thead>
              <tr>
                <th>User ID</th>
                <th>Username</th>
                <th>Friend Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="friends.length === 0">
                <td>No friends found.</td>
              </tr>
              <tr v-for="friend in friends">
                <td><router-link :to="'/accounts/'+friend.user.id">{{friend.user.id}}</router-link></td>
                <td>{{friend.user.username}}</td>
                <td v-if="friend.state === 1">Mutual Friends (0)</td>
                <td v-if="friend.state === 2">Invitation Sent (1)</td>
                <td v-if="friend.state === 3">Invitation Received (2)</td>
                <td v-if="friend.state === 4">Blocked (3)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import { Friend } from '@/store/types';

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
    friends(): Friend[] {
      return this.$store.getters.friends;
    },
  },
  methods: {
    async loadFriends(id: string): Promise<void> {
      this.loading = true;
      try {
        await this.$store.dispatch('loadFriends', id);
      } catch (error) {
        this.$emit('on-error', error);
      } finally {
        this.loading = false;
      }
    },
  },
  async created() {
    try {
      await this.loadFriends(this.id);
    } catch (error) {
      this.$emit('on-error', error);
    }
  },
});
</script>
