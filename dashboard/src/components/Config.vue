<template>
  <div class="config">
    <div style="margin-top: 30px;">
      <config-viewer></config-viewer>
    </div>
  </div>
</template>

<script>
  import ConfigViewer from './ConfigViewer';

  export default {
    name: 'config',
    components: {
      ConfigViewer,
    },
  };
</script>