var m = require("mithril");

var NodelistComponent = require("./nodelist");

module.exports = {
  view: function() {
    return m("div.c-card.c-card--higher", [
      m("header.c-card__header", [
        m("h2.c-heading", "Server cluster")
      ]),
      m("div.c-card__body", [
        m(NodelistComponent)
      ])
    ]);
  }
};
