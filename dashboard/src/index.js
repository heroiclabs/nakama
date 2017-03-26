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
