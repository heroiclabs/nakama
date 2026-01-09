export const environment = {
  production: true,
  // Use relative URL - nginx will proxy /v2/ to Nakama
  nakamaUrl: '',
  nakamaKey: 'une-cle-random-pour-les-clients',
  nakamaHttpKey: 'defaulthttpkey',
  devBypassAdminCheck: false
};
