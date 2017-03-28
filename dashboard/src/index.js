'use strict';

require([
  "font-awesome/css/font-awesome.css",
  "blaze/dist/blaze.min.css",
  "blaze/dist/blaze.colors.min.css"
]);
var m = require("mithril");

var Layout = require("./components/layout");
var HomeComponent = require("./components/home");
var ConfComponent = require("./components/configuration");

var root = document.body;
m.route(root, "/", {
  "/": {
    render: function() {
      return m(Layout, m(HomeComponent));
    }
  },
  "/configuration": {
    render: function() {
      return m(Layout, m(ConfComponent));
    }
  }
});
