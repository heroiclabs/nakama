'use strict';

var m = require("mithril");

var Node = {
  // State.
  "list": [],
  "error": "",
  // Behaviour.
  "fetch": function() {
    return m.request({
      "method": "GET",
      "url": "http://127.0.0.1:7351/v0/cluster/stats"
    }).then(function(result) {
      Node.list = result;
    }).catch(function(e) {
      Node.error = e.message;
    });
  }
};

module.exports = Node;
