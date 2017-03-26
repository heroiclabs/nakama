var m = require("mithril");

module.exports = {
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
      m("tbody.c-table__body", [
        m("div.c-table__row", [
          m("span.c-table__cell", "nakama-96b0"),
          m("span.c-table__cell", "192.168.0.26"),
          m("span.c-table__cell", "0.13.0-dev+c2d92e4"),
          m("span.c-table__cell", "0"),
          m("span.c-table__cell", "0"),
          m("span.c-table__cell", "14")
        ])
      ])
    ]);
  }
}
