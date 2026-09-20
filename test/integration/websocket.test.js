const http      = require('http');
const jwt       = require('jsonwebtoken');
const WebSocket = require('ws');

jest.mock('../../server/db', () => require('../mocks/db'));

const wsModule = require('../../server/ws');

// id=1 et id=2 existent dans le mock ; id=3 est banni ; id=555 n'existe pas
const tokenFor = (id, opts) => jwt.sign({ id, email: `u${id}@test.dz` }, process.env.JWT_SECRET, opts);
const AUTH_TIMEOUT_MS = 150;

let server, wss, port;
const sockets = [];

beforeAll(done => {
  server = http.createServer((_, res) => { res.statusCode = 404; res.end(); });
  wss = wsModule.setup(server, { authTimeoutMs: AUTH_TIMEOUT_MS });
  server.listen(0, '127.0.0.1', () => { port = server.address().port; done(); });
});
afterEach(() => { while (sockets.length) { try { sockets.pop().terminate(); } catch {} } });
afterAll(done => { wss.close(() => server.close(done)); });

function open(pathAndQuery = '/ws') {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${pathAndQuery}`);
  sockets.push(ws);
  ws.inbox = [];
  ws.on('message', raw => ws.inbox.push(JSON.parse(raw)));
  ws.on('error', () => {});
  return new Promise((resolve, reject) => { ws.once('open', () => resolve(ws)); ws.once('error', reject); });
}
const closed   = ws => new Promise(resolve => ws.once('close', (code, reason) => resolve({ code, reason: String(reason) })));
const nextMsg  = (ws, type, ms = 1000) => new Promise((resolve, reject) => {
  const hit = () => ws.inbox.find(m => m.type === type);
  if (hit()) return resolve(hit());
  const timer = setTimeout(() => reject(new Error(`message "${type}" non reçu`)), ms);
  ws.on('message', () => { const m = hit(); if (m) { clearTimeout(timer); resolve(m); } });
});
async function authed(id) {
  const ws = await open();
  ws.send(JSON.stringify({ type: 'auth', token: tokenFor(id) }));
  await nextMsg(ws, 'auth_ok');
  return ws;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

describe('WebSocket — authentification par premier message', () => {
  test('jeton valide : auth_ok, puis les notifications serveur arrivent', async () => {
    const ws = await authed(2);
    wsModule.send(2, { type: 'message', msg: { body: 'Bonjour' } });
    expect(await nextMsg(ws, 'message')).toEqual({ type: 'message', msg: { body: 'Bonjour' } });
  });

  test('le jeton en query string n\'authentifie plus : sans message auth, fermeture 4001 après le délai', async () => {
    const ws = await open(`/ws?token=${tokenFor(2)}`);
    const { code } = await closed(ws);
    expect(code).toBe(4001);
  });

  test('aucune notification n\'est délivrée avant l\'authentification', async () => {
    const ws = await open(`/ws?token=${tokenFor(2)}`);
    wsModule.send(2, { type: 'message', msg: { body: 'secret' } });
    await wait(50);
    expect(ws.inbox).toEqual([]);
  });

  test.each([
    ['jeton falsifié',              () => jwt.sign({ id: 2 }, 'autre-cle')],
    ['jeton expiré',                () => tokenFor(2, { expiresIn: -10 })],
    ['algorithme HS512 non accepté',() => jwt.sign({ id: 2 }, process.env.JWT_SECRET, { algorithm: 'HS512' })],
    ['compte banni',                () => tokenFor(3)],
    ['compte supprimé',             () => tokenFor(555)],
    ['chaîne quelconque',           () => 'pas-un-jwt'],
  ])('fermeture 4001 : %s', async (_label, makeToken) => {
    const ws = await open();
    ws.send(JSON.stringify({ type: 'auth', token: makeToken() }));
    expect((await closed(ws)).code).toBe(4001);
  });

  test('un premier message qui n\'est pas une authentification ferme la connexion', async () => {
    const ws = await open();
    ws.send(JSON.stringify({ type: 'typing', to: 1, listing_id: 1 }));
    expect((await closed(ws)).code).toBe(4001);
  });

  test('un jeton non textuel est refusé', async () => {
    const ws = await open();
    ws.send(JSON.stringify({ type: 'auth', token: { $ne: null } }));
    expect((await closed(ws)).code).toBe(4001);
  });

  test('du JSON invalide avant authentification est ignoré, puis le délai ferme la connexion', async () => {
    const ws = await open();
    ws.send('{pas du json');
    expect((await closed(ws)).code).toBe(4001);
  });

  test('une connexion authentifiée n\'est PAS fermée à l\'expiration du délai', async () => {
    const ws = await authed(2);
    await wait(AUTH_TIMEOUT_MS + 80);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe('WebSocket — cloisonnement et relais', () => {
  test('une notification n\'atteint que son destinataire', async () => {
    const host  = await authed(1);
    const guest = await authed(2);
    wsModule.send(1, { type: 'new_reservation', listing_title: 'Villa de test' });
    await nextMsg(host, 'new_reservation');
    await wait(40);
    expect(guest.inbox.filter(m => m.type === 'new_reservation')).toEqual([]);
  });

  test('plusieurs onglets du même utilisateur reçoivent tous la notification', async () => {
    const a = await authed(2);
    const b = await authed(2);
    wsModule.send(2, { type: 'message', msg: { body: 'x' } });
    await Promise.all([nextMsg(a, 'message'), nextMsg(b, 'message')]);
  });

  test('indicateur de frappe relayé avec l\'identité RÉELLE de l\'émetteur (le champ from du client est ignoré)', async () => {
    const host  = await authed(1);
    const guest = await authed(2);
    guest.send(JSON.stringify({ type: 'typing', to: 1, listing_id: 7, from: 98 }));
    expect(await nextMsg(host, 'typing')).toEqual({ type: 'typing', from: 2, listing_id: 7 });
  });

  test('après fermeture, l\'utilisateur ne reçoit plus rien et l\'envoi ne lève pas d\'erreur', async () => {
    const ws = await authed(2);
    ws.close();
    await closed(ws);
    await wait(20);
    expect(() => wsModule.send(2, { type: 'message', msg: {} })).not.toThrow();
  });

  test('message de plus de 16 Kio : connexion fermée (pas d\'accumulation mémoire)', async () => {
    const ws = await authed(2);
    ws.send(JSON.stringify({ type: 'typing', to: 1, pad: 'x'.repeat(20 * 1024) }));
    const { code } = await closed(ws);
    expect(code).toBe(1009);
  });
});
