<template>
  <div class="cluster-table">
    <el-card>
      <div slot="header" class="clearfix">
        <span style="line-height: 0px; font-weight: 600">Cluster Status</span>
      </div>
      <el-table v-bind:data="tableData" style="width: 100%" :row-class-name="tableRowClassName">
        <el-table-column prop="name" label="Node Name" width="300"></el-table-column>
        <el-table-column prop="address" label="Address" width="180"></el-table-column>
        <el-table-column prop="version" label="Version" width="180"></el-table-column>
        <el-table-column prop="health_status" label="Health Score" width="150"></el-table-column>
        <el-table-column prop="presence_count" label="Presence Count" width="150"></el-table-column>
        <el-table-column prop="process_count" label="Process Count" width="150"></el-table-column>
        <el-table-column></el-table-column>
    </el-card>
  </div>
</template>

<style>
  .el-table .healthy {
    background: #abeeb4;
  }

  .el-table .unhealthy {
    background: #ede89d;
  }

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
  const tableData = [];

  export default {
    name: 'cluster-table',
    created() {
      this.fetchData();
    },
    watch: {
      $route: 'fetchData',
    },
    methods: {
      fetchData() {
        const loadingInstance = this.$loading();
        fetch('/v0/cluster/stats').then((response) => {
          loadingInstance.close();
          if (response.status !== 200) {
            this.$notify.error({ title: 'Operation Failed', message: response.statusText });
          }

          response.json().then((json) => {
            tableData.length = 0;
            for (let i = 0; i < json.length; i += 1) {
              tableData.push(json[i]);
            }
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
    data: function getData() {
      return {
        tableData,
      };
    },
  };
</script>
