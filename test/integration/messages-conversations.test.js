const request = require('supertest');
const jwt     = require('jsonwebtoken');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/mailer', () => ({ mailNewMessage: jest.fn() }));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app    = require('../../server/index');
const db     = require('../mocks/db');
const mailer = require('../../server/mailer');
const ws     = require('../../server/ws');

// id=2 : voyageur ; id=1 : hôte de l'annonce 1 ; id=3 et annonce 7 : inconnus du mock
const GUEST = { Authorization: `Bearer ${jwt.sign({ id: 2, email: 'guest@test.dz' }, process.env.JWT_SECRET)}` };

const MSGS = () => [
  { id: 1, from_id: 1, to_id: 2, listing_id: 1, body: 'Bonjour',        created_at: '2026-03-01T10:00:00Z', read: false },
  { id: 2, from_id: 2, to_id: 1, listing_id: 1, body: 'Oui, disponible', created_at: '2026-03-01T11:00:00Z', read: false },
  { id: 3, from_id: 1, to_id: 2, listing_id: 1, body: 'Parfait',         created_at: '2026-03-01T12:00:00Z', read: false },
  { id: 4, from_id: 3, to_id: 2, listing_id: 7, body: 'Autre annonce',   created_at: '2026-03-05T09:00:00Z', read: true  },
];

afterEach(() => jest.clearAllMocks());

describe('GET /api/messages — construction des conversations', () => {
  test('une conversation par couple (annonce, interlocuteur), triées de la plus récente à la plus ancienne', async () => {
    db.messages.findByUser.mockResolvedValueOnce(MSGS());
    const res = await request(app).get('/api/messages').set(GUEST);
    expect(res.status).toBe(200);
    expect(res.body.data.map(c => c.key)).toEqual(['7-3', '1-1']);
    expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 2, pages: 1 });
  });

  test('le dernier message de chaque conversation est celui affiché', async () => {
    db.messages.findByUser.mockResolvedValueOnce(MSGS());
    const res = await request(app).get('/api/messages').set(GUEST);
    const conv = res.body.data.find(c => c.key === '1-1');
    expect(conv.last_msg).toBe('Parfait');
    expect(conv.last_at).toBe('2026-03-01T12:00:00Z');
  });

  test('non-lus : seuls les messages reçus et non lus comptent (pas ceux que j\'ai envoyés)', async () => {
    db.messages.findByUser.mockResolvedValueOnce(MSGS());
    const res = await request(app).get('/api/messages').set(GUEST);
    expect(res.body.data.find(c => c.key === '1-1').unread).toBe(2);
    expect(res.body.data.find(c => c.key === '7-3').unread).toBe(0);
  });

  test('titre d\'annonce et nom de l\'interlocuteur ; valeurs de repli si inconnus', async () => {
    db.messages.findByUser.mockResolvedValueOnce(MSGS());
    const res = await request(app).get('/api/messages').set(GUEST);
    expect(res.body.data.find(c => c.key === '1-1')).toMatchObject({ listing_title: 'Villa de test', other_name: 'Hôte Test', other_id: 1 });
    expect(res.body.data.find(c => c.key === '7-3')).toMatchObject({ listing_title: '', other_name: 'Inconnu' });
  });

  test('chargement en lot : un seul appel utilisateurs et un seul appel annonces (anti N+1)', async () => {
    db.messages.findByUser.mockResolvedValueOnce(MSGS());
    await request(app).get('/api/messages').set(GUEST);
    expect(db.users.findByIds).toHaveBeenCalledTimes(1);
    expect(db.users.findByIds.mock.calls[0][0].sort()).toEqual([1, 3]);
    expect(db.listings.findByIds).toHaveBeenCalledTimes(1);
    expect(db.listings.findByIds.mock.calls[0][0].sort()).toEqual([1, 7]);
  });

  test('pagination ?page=2&limit=1 : deuxième conversation', async () => {
    db.messages.findByUser.mockResolvedValueOnce(MSGS());
    const res = await request(app).get('/api/messages?page=2&limit=1').set(GUEST);
    expect(res.body.data.map(c => c.key)).toEqual(['1-1']);
    expect(res.body.pagination).toEqual({ page: 2, limit: 1, total: 2, pages: 2 });
  });

  test('page hors limites : liste vide mais total conservé', async () => {
    db.messages.findByUser.mockResolvedValueOnce(MSGS());
    const res = await request(app).get('/api/messages?page=9').set(GUEST);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(2);
  });

  test('limit plafonné à 50, valeurs invalides ramenées aux défauts', async () => {
    db.messages.findByUser.mockResolvedValueOnce(MSGS());
    const a = await request(app).get('/api/messages?limit=500').set(GUEST);
    expect(a.body.pagination.limit).toBe(50);
    db.messages.findByUser.mockResolvedValueOnce(MSGS());
    const b = await request(app).get('/api/messages?page=abc&limit=xyz').set(GUEST);
    expect(b.body.pagination).toMatchObject({ page: 1, limit: 20 });
  });

  test('les messages sont cherchés pour l\'utilisateur authentifié uniquement', async () => {
    await request(app).get('/api/messages').set(GUEST);
    expect(db.messages.findByUser).toHaveBeenCalledWith(2);
  });
});

describe('GET /api/messages/:listing_id/:other_id — fil de discussion', () => {
  test('200 : fil, interlocuteur et annonce, fil marqué comme lu', async () => {
    db.messages.findThread.mockResolvedValueOnce(MSGS().slice(0, 3));
    const res = await request(app).get('/api/messages/1/1').set(GUEST);
    expect(res.status).toBe(200);
    expect(res.body.thread).toHaveLength(3);
    expect(res.body.other).toEqual({ id: 1, name: 'Hôte Test' });
    expect(res.body.listing).toMatchObject({ id: 1, title: 'Villa de test' });
    expect(db.messages.findThread).toHaveBeenCalledWith(2, 1, 1);
    expect(db.messages.markThreadRead).toHaveBeenCalledWith(2, 1, 1);
  });

  test('interlocuteur ou annonce inconnus : réponse sans nom ni titre, sans crash', async () => {
    const res = await request(app).get('/api/messages/7/555').set(GUEST);
    expect(res.status).toBe(200);
    expect(res.body.other.name).toBeUndefined();
    expect(res.body.listing.title).toBeUndefined();
  });

  test('identifiants numériques partiels ("12abc") lus comme 12 (parseInt)', async () => {
    await request(app).get('/api/messages/1/2abc').set(GUEST);
    expect(db.messages.findThread).toHaveBeenCalledWith(2, 2, 1);
  });
});

describe('POST /api/messages — envoi', () => {
  const send = body => request(app).post('/api/messages').set(GUEST).send(body);

  test('201 : message créé avec expéditeur = utilisateur du token (jamais du corps), non lu', async () => {
    const res = await send({ to_id: 1, listing_id: 1, body: '  Bonjour  ', from_id: 99, read: true });
    expect(res.status).toBe(201);
    expect(db.messages.create).toHaveBeenCalledWith({ from_id: 2, to_id: 1, listing_id: 1, body: 'Bonjour', read: false });
  });

  test('ids fournis en chaînes convertis en nombres', async () => {
    await send({ to_id: '1', listing_id: '1', body: 'Salut' });
    expect(db.messages.create).toHaveBeenCalledWith(expect.objectContaining({ to_id: 1, listing_id: 1 }));
  });

  test('e-mail au destinataire avec l\'aperçu du message', async () => {
    await send({ to_id: 1, listing_id: 1, body: 'Le logement est-il libre ?' });
    expect(mailer.mailNewMessage).toHaveBeenCalledWith({
      to: 'host@test.dz', senderName: 'Guest Test', listingTitle: 'Villa de test', preview: 'Le logement est-il libre ?',
    });
  });

  test('notification WebSocket au destinataire avec nom d\'expéditeur et titre d\'annonce', async () => {
    await send({ to_id: 1, listing_id: 1, body: 'Bonjour' });
    expect(ws.send).toHaveBeenCalledWith(1, expect.objectContaining({
      type: 'message',
      msg: expect.objectContaining({ sender_name: 'Guest Test', listing_title: 'Villa de test', body: 'Bonjour' }),
    }));
  });

  test('400 si le message ne contient que des espaces', async () => {
    const res = await send({ to_id: 1, listing_id: 1, body: '    ' });
    expect(res.status).toBe(400);
    expect(db.messages.create).not.toHaveBeenCalled();
  });

  test('message de 2000 caractères accepté, 2001 refusé', async () => {
    expect((await send({ to_id: 1, listing_id: 1, body: 'x'.repeat(2000) })).status).toBe(201);
    expect((await send({ to_id: 1, listing_id: 1, body: 'x'.repeat(2001) })).status).toBe(400);
  });

  test('404 si l\'annonce n\'existe pas : rien n\'est créé ni notifié', async () => {
    const res = await send({ to_id: 1, listing_id: 9999, body: 'Bonjour' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/annonce/i);
    expect(db.messages.create).not.toHaveBeenCalled();
    expect(ws.send).not.toHaveBeenCalled();
    expect(mailer.mailNewMessage).not.toHaveBeenCalled();
  });

  test('destinataire sans e-mail : message créé, pas de mail', async () => {
    db.users.findById.mockImplementationOnce(() => Promise.resolve({ id: 1, name: 'Sans mail' }));
    const res = await send({ to_id: 1, listing_id: 1, body: 'Bonjour' });
    expect(res.status).toBe(201);
    expect(mailer.mailNewMessage).not.toHaveBeenCalled();
  });
});

describe('GET /api/messages/unread-count', () => {
  test('retourne le compteur de l\'utilisateur authentifié', async () => {
    db.messages.countUnread.mockResolvedValueOnce(5);
    const res = await request(app).get('/api/messages/unread-count').set(GUEST);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 5 });
    expect(db.messages.countUnread).toHaveBeenCalledWith(2);
  });
});
