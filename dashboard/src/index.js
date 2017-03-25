var m = require("mithril");

var Layout = require("./components/layout");
var HomeComponent = require("./components/home");

m.route(document.body, "/", {
  "/": {
    render: function() {
      return m(Layout, m(HomeComponent));
    }
  }
});
