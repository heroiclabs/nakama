<template>
  <div class="topbar">
    <el-row type="flex">
      <el-col :span="24">
        <div class="grid-content">
          <el-menu router unique-opened theme="dark" mode="horizontal" style="border-radius: 0px">

            <a href="https://heroiclabs.com" title="Heroic Labs">
              <el-menu-item index="">
                <img src="../assets/logo.png" height="60">
              </el-menu-item>
            </a>

            <el-menu-item index="1" v-bind:route="{ path: '/' }">Cluster</el-menu-item>
            <el-menu-item index="2" v-bind:route="{ path: '/config' }">Config</el-menu-item>

            <a href="https://heroiclabs.com/docs" title="Documentation">
              <el-menu-item class="icon-padding" index="">
                <img src="../assets/docs.png" height="23">
              </el-menu-item>
            </a>

            <a href="https://github.com/heroiclabs/nakama" title="GitHub">
              <el-menu-item class="icon-padding" index="">
                <img src="../assets/github.png" height="25">
              </el-menu-item>
            </a>

            <a href="https://gitter.im/heroiclabs/nakama" title="Gitter Community Chat">
              <el-menu-item class="icon-padding" index="">
                <img src="../assets/gitter.png" height="28">
              </el-menu-item>
            </a>

            <a href="https://twitter.com/heroicdev" title="Twitter">
              <el-menu-item class="icon-padding" index="">
                <img src="../assets/twitter.png" height="20">
              </el-menu-item>
            </a>

            <a href="https://medium.com/heroiclabs" title="Medium">
              <el-menu-item class="icon-padding" index="">
                <img src="../assets/medium.png" height="21">
              </el-menu-item>
            </a>

          </el-menu>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<style>
  .icon-padding {
    padding-top: 8px;
  }
</style>

<script>
  export default {
    name: 'topbar',
  };
</script>
