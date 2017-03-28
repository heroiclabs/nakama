'use strict';

var m = require("mithril");

module.exports = {
  view: function(vnode) {
    return m("div", [
      m("nav.c-nav.c-nav--inline", [
        m("a.c-nav__item[href='/']", {oncreate: m.route.link}, "Nakama dashboard"),
        m("a.c-nav__item[href='/']", {oncreate: m.route.link}, "Home"),
        m("a.c-nav__item[href='/configuration']", {oncreate: m.route.link}, "Configuration"),

        // Added in reverse order for CSS styles
        m("a.c-nav__item.c-nav__item--right[href='https://twitter.com/heroicdev'][target=_blank]", [
          m("i.fa.fa-twitter", {"aria-hidden": "true"}),
          " Twitter"
        ]),
        m("a.c-nav__item.c-nav__item--right[href='https://github.com/heroiclabs/nakama'][target=_blank]", [
          m("i.fa.fa-github", {"aria-hidden": "true"}),
          " GitHub"
        ]),
        m("a.c-nav__item.c-nav__item--right[href='https://gitter.im/heroiclabs/nakama'][target=_blank]", [
          m("i.fa.fa-comments", {"aria-hidden": "true"}),
          " Community"
        ]),
        m("a.c-nav__item.c-nav__item--right[href='https://heroiclabs.com/docs'][target=_blank]", [
          m("i.fa.fa-book", {"aria-hidden": "true"}),
          " Docs"
        ])
      ]),
      m("div.o-grid.o-panel.o-panel--nav-top", [
        m("main.o-grid__cell", vnode.children)
      ])
    ]);
  }
};
