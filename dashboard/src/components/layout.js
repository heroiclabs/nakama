var m = require("mithril");

module.exports = {
  view: function(vnode) {
    return m("main.layout", [
      m("nav.menu", [
        m("a[href='/']", {oncreate: m.route.link}, "Home")
      ]),
      m("section", vnode.children)
    ]);
  }
};
