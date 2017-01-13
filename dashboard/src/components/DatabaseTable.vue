<template>
  <div class="database-table">

    <el-card>
      <div slot="header" class="clearfix">
        <span style="line-height: 0px; font-weight: 600">Database List</span>
      </div>
      <el-table :data="tableData" style="width: 100%" :row-class-name="tableRowClassName">
        <el-table-column></el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style>
  .el-table .info-row {
    background: #f97515;
  }

  .el-table .positive-row {
    background: #e2f0e4;
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
  export default {
    name: 'database-table',
    methods: {
      tableRowClassName(row, index) {
        if (index === 1) {
          return 'info-row';
        } else if (index === 3) {
          return 'positive-row';
        }
        return '';
      },
    },
    data() {
      return {
        tableData: [{
          address: '127.0.0.1',
          version: '0.0.1',
        }],
      };
    },
  };
</script>