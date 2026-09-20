const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');

// Extrait l'objet TRANSLATIONS inline (fermé par "};" en colonne 0) et l'évalue isolément
function loadTranslations() {
  const m = HTML.match(/const TRANSLATIONS = (\{[\s\S]*?\n\});/);
  if (!m) throw new Error('Objet TRANSLATIONS introuvable dans public/index.html');
  return vm.runInNewContext('(' + m[1] + ')');
}

const T = loadTranslations();
const keysOf = lang => new Set(Object.keys(T[lang]));

// Clés statiques référencées dans le HTML (data-i18n*) et dans le JS (t('cle'))
const HTML_KEYS = new Set([...HTML.matchAll(/data-i18n(?:-html|-placeholder|-title)?="([^"]+)"/g)].map(m => m[1]));
const JS_KEYS   = new Set([...HTML.matchAll(/(?<![\w.$])t\('([a-z][\w]*(?:\.[\w]+)*)'\)/g)].map(m => m[1]));

const missing = (wanted, lang) => [...wanted].filter(k => !keysOf(lang).has(k)).sort();

describe('i18n — structure', () => {
  test('les 4 langues attendues sont déclarées', () => {
    expect(Object.keys(T).sort()).toEqual(['ar', 'en', 'fr', 'kab']);
  });

  test.each(['fr', 'ar', 'en', 'kab'])('%s : aucune traduction vide', lang => {
    const empty = Object.entries(T[lang]).filter(([, v]) => typeof v !== 'string' || !v.trim()).map(([k]) => k);
    expect(empty).toEqual([]);
  });
});

// Règle du projet : toute chaîne doit exister en français ET en arabe
describe('i18n — parité FR / AR', () => {
  test('toute clé française existe en arabe', () => {
    expect(missing(keysOf('fr'), 'ar')).toEqual([]);
  });

  test('toute clé arabe existe en français', () => {
    expect(missing(keysOf('ar'), 'fr')).toEqual([]);
  });

  test('les valeurs arabes contiennent bien des caractères arabes (pas de texte français copié)', () => {
    const ARABIC = /[؀-ۿ]/;
    // Noms de marque des modes de paiement, volontairement identiques dans toutes les langues
    const BRANDS = new Set(['Edahabia', 'CIB', 'BaridiMob']);
    const suspects = Object.entries(T.ar)
      .filter(([, v]) => /[A-Za-zÀ-ÿ]{4,}/.test(v) && !ARABIC.test(v) && !BRANDS.has(v.trim()))
      .map(([k]) => k);
    expect(suspects).toEqual([]);
  });

  test('placeholders {x} identiques entre FR et AR', () => {
    const ph = s => (s.match(/\{\w+\}/g) || []).sort().join(',');
    const diff = Object.keys(T.fr).filter(k => T.ar[k] !== undefined && ph(T.fr[k]) !== ph(T.ar[k]));
    expect(diff).toEqual([]);
  });
});

describe('i18n — clés utilisées par l\'interface', () => {
  test('données extraites du HTML (garde-fou contre une regex devenue muette)', () => {
    expect(HTML_KEYS.size).toBeGreaterThan(20);
    expect(JS_KEYS.size).toBeGreaterThanOrEqual(10);
  });

  test.each(['fr', 'ar'])('%s : toutes les clés data-i18n du HTML sont définies', lang => {
    expect(missing(HTML_KEYS, lang)).toEqual([]);
  });

  test.each(['fr', 'ar'])('%s : toutes les clés t(\'...\') du JS sont définies', lang => {
    expect(missing(JS_KEYS, lang)).toEqual([]);
  });
});
