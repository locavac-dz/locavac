const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const HTML   = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
// Script applicatif : le seul <script> sans attribut (les deux premiers sont du JSON-LD)
const SCRIPT = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];

// Extrait le source d'une fonction nommée par appariement d'accolades
function extractFn(name) {
  const start = SCRIPT.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Fonction ${name} introuvable dans index.html`);
  let i = SCRIPT.indexOf('{', SCRIPT.indexOf(')', start));
  let depth = 0;
  for (; i < SCRIPT.length; i++) {
    if (SCRIPT[i] === '{') depth++;
    else if (SCRIPT[i] === '}' && --depth === 0) return SCRIPT.slice(start, i + 1);
  }
  throw new Error(`Accolades non appariées pour ${name}`);
}

// Bac à sable : les fonctions réelles du frontend, un faux DOM minimal, et des espions pour les fonctions appelées
function sandbox(fnNames, extra = {}) {
  const elements = {};
  const ctx = {
    document: { getElementById: id => (elements[id] ||= { innerHTML: '', textContent: '', style: {} }) },
    Number, String, JSON, Math, Date, Array, Object, RegExp, console,
    ...extra,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fnNames.map(extractFn).join('\n'), ctx);
  ctx.elements = elements;
  return ctx;
}

const onclicks = html => [...html.matchAll(/onclick="([^"]*)"/g)].map(m => m[1]);
const srcs     = html => [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map(m => m[1]);

describe('Le script applicatif reste syntaxiquement valide', () => {
  test('compilation du <script> principal de index.html', () => {
    expect(() => new vm.Script(SCRIPT)).not.toThrow();
  });
});

describe('safeUrl — URL pour attribut src/href', () => {
  const { safeUrl } = sandbox(['escapeHtml', 'safeUrl']);

  test.each([
    'https://images.unsplash.com/photo-1.jpg?w=800&q=80', 'http://localhost:3000/uploads/a.jpg',
    '/uploads/2_1700000000000_abcdef0123456789.jpg', 'blob:https://locavac.dz/1234', 'data:image/png;base64,iVBORw0KGgo=',
  ])('accepte %s', url => {
    expect(safeUrl(url)).not.toBe('');
  });

  test.each([
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', '  javascript:alert(1)', 'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>', '//evil.example/x.js', 'uploads/relatif.jpg', '', null, undefined, 42,
  ])('rejette %p', url => {
    expect(safeUrl(url)).toBe('');
  });

  test('une URL valide contenant des guillemets ne peut pas sortir de l\'attribut', () => {
    const out = safeUrl('https://x.dz/a.jpg" onerror="alert(1)');
    expect(out).not.toContain('"');
    expect(out).toContain('&quot;');
  });

  test('les esperluettes sont échappées sans casser l\'URL', () => {
    expect(safeUrl('https://x.dz/a.jpg?w=800&q=80')).toBe('https://x.dz/a.jpg?w=800&amp;q=80');
  });
});

describe('Mes réservations — cartes et boutons', () => {
  const EVIL_TITLE = 'Villa "Les Pins" d\'Oran <img src=x onerror=alert(1)> x" onmouseover="alert(2)';
  const resa = (over = {}) => ({
    id: 300, listing_id: 1, title: EVIL_TITLE, image: 'javascript:alert(3)', check_in: '2027-06-01', check_out: '2027-06-05',
    total_price: 20000, status: 'confirmed', cancellation_policy: 'moderee', can_review: false, ...over,
  });
  const render = data => {
    const ctx = sandbox(['escapeHtml', 'escHtml', 'safeUrl', '_renderResaCards']);
    ctx._guestResasData = data;
    ctx._renderResaCards(data, 'all');
    return ctx.elements['resa-list'].innerHTML;
  };

  test('le titre malveillant est affiché comme du texte, aucune balise ni attribut injecté', () => {
    const html = render([resa()]);
    expect(html).not.toMatch(/<img src=x/);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toMatch(/\sonmouseover="/);
  });

  test('chaque onclick ne contient qu\'un appel à arguments numériques (plus de titre ni d\'objet sérialisé)', () => {
    const html = render([resa(), resa({ id: 301, status: 'pending', can_review: true })]);
    const handlers = onclicks(html);
    expect(handlers.length).toBeGreaterThanOrEqual(5);
    for (const h of handlers) expect(h).toMatch(/^[A-Za-z_]+\(\d+(,\d+(\.\d+)?)?\)$/);
    expect(handlers).toContain('cancelResaById(300)');
    expect(handlers).toContain('printResaById(300)');
    expect(handlers).toContain('openPayment(301,20000)');
  });

  test('régression : le bouton Annuler est bien formé même quand le titre contient des guillemets', () => {
    const html = render([resa()]);
    // L'ancien code produisait onclick="cancelResa(300,…,"Villa … : attribut tronqué, bouton mort
    expect(html).toMatch(/onclick="cancelResaById\(300\)">✕ Annuler<\/button>/);
    expect(html).not.toMatch(/JSON|cancelResa\(300,/);
  });

  test('une image au schéma javascript: donne un src vide ; une URL d\'upload est conservée', () => {
    expect(srcs(render([resa()]))).toEqual(['']);
    expect(srcs(render([resa({ image: '/uploads/2_1_abcdef0123456789.jpg' })]))).toEqual(['/uploads/2_1_abcdef0123456789.jpg']);
  });

  test('un id non numérique venu de l\'API ne peut pas injecter de code dans onclick', () => {
    const html = render([resa({ id: '1);alert(1);//', total_price: '1);alert(2);//', status: 'pending' })]);
    for (const h of onclicks(html)) expect(h).not.toMatch(/alert/);
  });

  test('un statut inattendu ne devient pas une classe CSS arbitraire', () => {
    const html = render([resa({ status: 'x" onclick="alert(1)' })]);
    expect(html).toMatch(/class="resa-status-badge "/);
  });

  test('cancelResaById retrouve la réservation et transmet le titre exact (guillemets et apostrophes compris)', () => {
    const cancelResa = jest.fn();
    const ctx = sandbox(['_findGuestResa', 'cancelResaById'], { cancelResa });
    ctx._guestResasData = [resa()];
    ctx.cancelResaById(300);
    expect(cancelResa).toHaveBeenCalledWith(300, 20000, '2027-06-01', 'moderee', EVIL_TITLE);
  });

  test('cancelResaById : politique flexible par défaut, id inconnu ignoré, id en chaîne accepté', () => {
    const cancelResa = jest.fn();
    const ctx = sandbox(['_findGuestResa', 'cancelResaById'], { cancelResa });
    ctx._guestResasData = [resa({ cancellation_policy: undefined })];
    ctx.cancelResaById(9999);
    expect(cancelResa).not.toHaveBeenCalled();
    ctx.cancelResaById('300');
    expect(cancelResa).toHaveBeenCalledWith(300, 20000, '2027-06-01', 'flexible', EVIL_TITLE);
  });

  test('printResaById transmet l\'objet complet depuis la liste chargée', () => {
    const printResa = jest.fn();
    const ctx = sandbox(['_findGuestResa', 'printResaById'], { printResa });
    const r = resa();
    ctx._guestResasData = [r];
    ctx.printResaById(300);
    expect(printResa).toHaveBeenCalledWith(r);
    ctx.printResaById(1);
    expect(printResa).toHaveBeenCalledTimes(1);
  });

  test('printResa échappe le titre dans le document imprimable', () => {
    let written = '';
    const fakeWin = { document: { write: s => { written += s; }, close() {} }, focus() {}, print() {} };
    const ctx = sandbox(['escapeHtml', 'printResa'], { toast: jest.fn(), open: () => fakeWin });
    ctx.printResa(resa());
    expect(written).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(written).not.toMatch(/<img src=x/);
  });
});

describe('Cartes des établissements partenaires', () => {
  const { renderPubCard } = sandbox(['escapeHtml', 'escHtml', 'safeUrl', 'renderPubCard']);
  const evil = forfait => ({
    forfait, type: 'hotel', etoiles: 4,
    nom: '<script>alert(1)</script>', wilaya: '<b>Alger</b>', ville: '"><svg onload=alert(2)>',
    description: '<img src=x onerror=alert(3)>', logo: 'javascript:alert(4)',
    telephone: '0555 12-34"><script>alert(5)</script>', site_web: 'javascript:alert(6)', email_contact: 'a@b.dz"><img src=x>',
  });

  test.each(['vedette', 'premium', 'basic'])('forfait %s : aucune balise ni schéma exécutable injecté', forfait => {
    const html = renderPubCard(evil(forfait));
    expect(html).not.toMatch(/<script|<svg|<img src=x|<b>/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('liens dangereux supprimés : pas de bouton site web ni e-mail, téléphone réduit à ses chiffres', () => {
    const html = renderPubCard(evil('basic'));
    expect(html).not.toMatch(/Site web/);
    expect(html).not.toMatch(/mailto:/);
    const tel = html.match(/href="tel:([^"]*)"/)[1];
    expect(tel).toMatch(/^[\d+\s().-]+$/);
    expect(tel.startsWith('0555 12-34')).toBe(true);
  });

  test('valeurs légitimes conservées, lien externe en noopener noreferrer', () => {
    const html = renderPubCard({
      forfait: 'premium', type: 'hotel', nom: 'Hôtel El Djazaïr', wilaya: 'Alger', logo: '/uploads/logo.png',
      telephone: '+213 21 23 09 33', site_web: 'https://hotel.example.dz/?a=1&b=2', email_contact: 'contact@hotel.dz',
    });
    expect(html).toContain('Hôtel El Djazaïr');
    expect(srcs(html)).toEqual(['/uploads/logo.png']);
    expect(html).toMatch(/href="https:\/\/hotel\.example\.dz\/\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer"/);
    expect(html).toMatch(/href="tel:\+213 21 23 09 33"/);
    expect(html).toMatch(/href="mailto:contact@hotel\.dz"/);
  });

  test('un site_web relatif ou en //hôte n\'est pas un lien externe valide', () => {
    expect(renderPubCard({ forfait: 'basic', nom: 'X', wilaya: 'Y', site_web: '//evil.dz' })).not.toMatch(/Site web/);
    expect(renderPubCard({ forfait: 'basic', nom: 'X', wilaya: 'Y', site_web: '/interne' })).not.toMatch(/Site web/);
  });
});

describe('Garde-fous statiques sur index.html', () => {
  const lines = HTML.split(/\r?\n/).map((text, i) => ({ n: i + 1, text }));
  const offenders = re => lines.filter(l => re.test(l.text)).map(l => `${l.n}: ${l.text.trim().slice(0, 90)}`);

  test('aucun src/href interpolé sans safeUrl/escapeHtml/escHtml', () => {
    expect(offenders(/(?:src|href)="\$\{(?!safeUrl\(|escapeHtml\(|escHtml\(|logo\}|web\})/)).toEqual([]);
  });

  test('aucun alt interpolé sans échappement', () => {
    expect(offenders(/alt="\$\{(?!escapeHtml\(|escHtml\(|nom\})/)).toEqual([]);
  });

  test('plus aucun JSON.stringify dans un attribut onclick', () => {
    expect(offenders(/onclick=['"][^'"]*\$\{JSON\.stringify/)).toEqual([]);
  });
});
