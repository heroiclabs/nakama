'use strict';

var m = require("mithril");
var Conf = require("../models/conf");

var jsonToYaml = function(obj, depth, acc) {
  var type = typeof obj;
  if (obj instanceof Array) {
    obj.forEach(function(elem) {
      var subAcc = [];
      jsonToYaml(elem, depth + 1, subAcc);
      var empty = subAcc.length === 0;
      var prefix = '  '.repeat(depth) + '- ';
      acc.push((empty ? '' : '\n') + (empty ? '' : prefix) + subAcc.join('\n' + prefix).trim())
    });
  } else if (type === 'object') {
    var first = true;
    var prefix = '  '.repeat(depth);
    Object.keys(obj).forEach(function(key) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        acc.push((first ? '\n' : '') + prefix + key + ':' + jsonToYaml(obj[key], depth + 1, []));
        first = false;
      }
    });
  } else if (type === 'string') {
    acc.push(' "' + obj + '"');
  } else if (type === 'boolean') {
    acc.push(obj ? ' true' : ' false');
  } else if (type === 'number') {
    acc.push(' ' + obj.toString());
  } else {
    acc.push(' null');
  }
  return acc.join('\n');
};

module.exports = {
  oninit: Conf.fetch,
  view: function() {
    var yaml = jsonToYaml(Conf.value, 0, []).trim();
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
        : m("textarea.c-field.c-field--large", {"disabled": true, "rows": 25}, yaml)
      ])
    ]);
  }
};
