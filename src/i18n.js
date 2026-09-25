'use strict';
// Minimal i18n: flat key->string maps for EN/FR, loaded once.
const en = require('../locales/en.json');
const fr = require('../locales/fr.json');

const DICTS = { en, fr };

function t(locale, key, vars = {}) {
  const dict = DICTS[locale] || DICTS.en;
  let str = dict[key] || DICTS.en[key] || key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{{${k}}}`, v);
  }
  return str;
}

module.exports = { t, locales: Object.keys(DICTS) };
