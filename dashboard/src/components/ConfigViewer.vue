<template>
  <div class="config-viewer">
    <el-card>
      <div slot="header" class="clearfix">
        <span style="line-height: 0px; font-weight: 600">Configuration</span>
      </div>
      <el-input type="textarea" :autosize="{ minRows: 30, maxRows: 30}" placeholder="Configuration" v-model="configData.d"></el-input>
    </el-card>
  </div>
</template>

<style>
  .text {
    font-size: 14px;
  }

  .item {
    padding: 18px 0;
  }

  .clearfix:before,
  .clearfix:after {
      display: table;
      content: "";
  }
  .clearfix:after {
      clear: both
  }
</style>

<script>
  const configData = {
    d: '',
  };

  export default {
    name: 'config-viewer',
    created() {
      this.fetchData();
    },
    watch: {
      $route: 'fetchData',
    },
    methods: {
      fetchData() {
        const loadingInstance = this.$loading();
        fetch('/v0/config').then((response) => {
          loadingInstance.close();
          if (response.status !== 200) {
            this.$notify.error({ title: 'Operation Failed', message: response.statusText });
          }
          response.json().then((json) => {
            configData.d = JSON.stringify(json, null, 2);
          });
        }).catch(() => {
          loadingInstance.close();
          this.$notify.error({ title: 'Operation Failed', message: 'Failed to connect to server.' });
        });
      },
      tableRowClassName(row) {
        if (row.health_status === 0) {
          return 'healthy';
        }
        return 'unhealthy';
      },
    },
    data() {
      return {
        configData,
      };
    },
  };
</script>
