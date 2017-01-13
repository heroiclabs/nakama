<template>
  <div class="cluster">
    <div style="margin-top: 30px;">
      <cluster-table></cluster-table>
    </div>
    <!--<div style="margin-top: 30px;">-->
      <!--<database-table></database-table>-->
    <!--</div>-->
  </div>
</template>

<script>
  import ClusterTable from './ClusterTable';
  import DatabaseTable from './DatabaseTable';

  export default {
    name: 'cluster',
    components: {
      ClusterTable,
      DatabaseTable,
    },
  };
</script>
