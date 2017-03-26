'use strict';

var m = require("mithril");

var Node = {
  // State.
  "list": [{ // FIXME remove devstate
    "address":"192.168.0.26",
    "health_status":0,
    "name":"nakama-ae87",
    "presence_count":0,
    "process_count":11,
    "version":"0.13.0-dev+c2d92e4"
  }],
  "error": "",
  // Behaviour.
  "fetch": function() {
    return m.request({
      "method": "GET",
      "url": "http://127.0.0.1:7351/v0/cluster/stats"
    // }).then(function(result) {
    //   Node.list = result.data;
    }).catch(function(e) {
      Node.error = e.message;
    });
  }
};

module.exports = Node;
