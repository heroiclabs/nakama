'use strict';

var m = require("mithril");

module.exports = {
  view: function() {
    return m("div.c-card.c-card--higher", [
      m("header.c-card__header", [
        m("h2.c-heading", "Server configuration")
      ]),
      m("div.c-card__body", [])
    ]);
  }
};
