'use strict';

var m = require("mithril");
var Conf = require("../models/conf");

var jsonToYaml = function(obj, depth, acc) {
  // TODO replace with proper impl.
  return JSON.stringify(obj, null, '\t');
};

module.exports = {
  oninit: Conf.fetch,
  view: function() {
    return m("div.c-card.c-card--higher", [
      m("header.c-card__header", [
        m("h2.c-heading", "Server configuration")
      ]),
      m("div.c-card__body", [
        m("p.c-paragraph", [
          "For more information on the configuration settings see the ",
          m("a[href='https://heroiclabs.com/docs/configure/'][target=_blank]", "docs"),
          "."
        ]),
        Conf.error ?
          m("p.c-paragraph.u-color-red-dark", Conf.error)
        : m("textarea.c-field c-field--large", {"disabled": true, "rows": 20}, jsonToYaml(Conf.value))
      ])
    ]);
  }
};
