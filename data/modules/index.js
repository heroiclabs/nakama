"use strict";
var TEST_RPC = function (ctx, logger, nk, payload) {
    try {
        throw new Error('test_error');
    }
    catch (e) {
        throw e;
    }
};
var InitModule = function (ctx, logger, nk, initializer) {
    initializer.registerRpc('TEST_RPC', TEST_RPC);
};
