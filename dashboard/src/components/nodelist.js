'use strict';

var m = require("mithril");
var Node = require("../models/node");

module.exports = {
  oninit: Node.fetch,
  view: function() {
    return m("div.c-table.c-table--striped", [
      m("div.c-table__caption", "Healthy nodes are marked in green."),
      m("div.c-table__row.c-table__row--heading", [
        m("span.c-table__cell", "Node name"),
        m("span.c-table__cell", "Address"),
        m("span.c-table__cell", "Version"),
        m("span.c-table__cell", "Health score"),
        m("span.c-table__cell", "Presence count"),
        m("span.c-table__cell", "Process count")
      ]),
      m("tbody.c-table__body", Node.list.map(function(node) {
        return m("div.c-table__row", [
          m("span.c-table__cell", node.name),
          m("span.c-table__cell", node.address),
          m("span.c-table__cell", node.version),
          m("span.c-table__cell", node.health_status),
          m("span.c-table__cell", node.presence_count),
          m("span.c-table__cell", node.process_count)
        ])
      }))
    ]);
  }
}
