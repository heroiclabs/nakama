<template>
  <div class="ui segment" :class="{'loading': loading}">
    <h3>Groups</h3>
    <div class="ui column grid" v-if="!loading">
      <div class="row">
        <div class="column">
          <table class="ui table">
            <thead>
              <tr>
                <th>Group ID</th>
                <th>Group Name</th>
                <th>Status</th>
                <th>Creator ID</th>
                <th>Open / Private</th>
                <th>Edge / Max Count</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="groups.length === 0">
                <td>No groups found.</td>
              </tr>
              <tr v-for="g in groups">
                <td>{{g.group.id}}</td>
                <td>{{g.group.name}}</td>
                <td v-if="g.state === 1">Superadmin (0)</td>
                <td v-if="g.state === 2">Admin (1)</td>
                <td v-if="g.state === 3">Member (2)</td>
                <td v-if="g.state === 4">Join Request Sent (3)</td>
                <td><router-link :to="'/accounts/'+g.group.creator_id">{{g.group.creator_id}}</router-link></td>
                <td v-if="g.group.open">Open</td>
                <td v-if="!g.group.open">Private</td>
                <td>{{g.group.edge_count}} / {{g.group.max_count}}</td>
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
import { Group, UserGroup } from '@/store/types';

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
    groups(): UserGroup[] {
      return this.$store.getters.groups;
    },
  },
  methods: {
    async loadGroups(id: string): Promise<void> {
      this.loading = true;
      try {
        await this.$store.dispatch('loadGroups', id);
      } catch (error) {
        this.$emit('on-error', error);
      } finally {
        this.loading = false;
      }
    },
  },
  async created() {
    try {
      await this.loadGroups(this.id);
    } catch (error) {
      this.$emit('on-error', error);
    }
  },
});
</script>
