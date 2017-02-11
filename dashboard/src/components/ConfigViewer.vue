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

  function jsonToYaml(obj, depth, acc) {
    const type = typeof obj;
    if (obj instanceof Array) {
      obj.forEach((ele) => {
        const subAcc = [];
        jsonToYaml(ele, depth + 1, subAcc);
        const empty = subAcc.length === 0;
        const prefix = `${'  '.repeat(depth)}- `;
        acc.push((empty ? '' : '\n') + (empty ? '' : prefix) + subAcc.join(`\n${prefix}`).trim());
      });
    } else if (type === 'object') {
      let first = true;
      const prefix = '  '.repeat(depth);
      Object.keys(obj).forEach((k) => {
        if (Object.prototype.hasOwnProperty.call(obj, k)) {
          acc.push(`${first ? `\n${prefix}` : prefix}${k}:${jsonToYaml(obj[k], depth + 1, [])}`);
          first = false;
        }
      });
    } else if (type === 'string') {
      acc.push(` "${obj}"`);
    } else if (type === 'boolean') {
      acc.push(obj ? ' true' : ' false');
    } else if (type === 'number') {
      acc.push(` ${obj.toString()}`);
    } else {
      acc.push(' null');
    }
    return acc.join('\n');
  }

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
            configData.d = jsonToYaml(json, 0, []).trim();
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
