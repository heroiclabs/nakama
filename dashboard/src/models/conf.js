'use strict';

var m = require("mithril");

var Conf = {
  // State.
  "value": {},
  "error": "",
  // Behaviour.
  "fetch": function() {
    return m.request({
      "method": "GET",
      "url": "http://127.0.0.1:7351/v0/config"
    }).then(function(result) {
      Conf.value = result;
    }).catch(function(e) {
      Conf.error = e.message;
    });
  }
};

module.exports = Conf;
