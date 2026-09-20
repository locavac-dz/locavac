const request = require('supertest');

jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/ws', () => ({ send: jest.fn(), setup: jest.fn() }));

const app = require('../../server/index');
const db  = require('../mocks/db');

const unsubscribe = body => request(app).post('/api/newsletter/unsubscribe').send(body);
const deleteCall  = () => db.pool.query.mock.calls.find(c => /DELETE FROM newsletter_subscribers/.test(c[0]));

afterEach(() => jest.clearAllMocks());

describe('POST /api/newsletter/unsubscribe — droit d\'opposition', () => {
  test('200 : l\'adresse est supprimée, normalisée en minuscules', async () => {
    const res = await unsubscribe({ email: '  Nadia@Test.DZ ' .trim() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(deleteCall()[1]).toEqual(['nadia@test.dz']);
  });

  test('même réponse pour une adresse jamais inscrite (on ne révèle pas qui est abonné)', async () => {
    const a = await unsubscribe({ email: 'inscrit@test.dz' });
    const b = await unsubscribe({ email: 'jamais-inscrit@test.dz' });
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
  });

  test.each([undefined, '', 'pas-un-email', 'a@b', { $ne: null }, `${'x'.repeat(250)}@test.dz`])('400 pour %p, aucune requête SQL', async email => {
    const res = await unsubscribe({ email });
    expect(res.status).toBe(400);
    expect(deleteCall()).toBeUndefined();
  });

  test('l\'adresse est un paramètre SQL, jamais interpolée', async () => {
    await unsubscribe({ email: "x'--@test.dz" });
    const [sql, params] = deleteCall();
    expect(sql).toBe('DELETE FROM newsletter_subscribers WHERE email = $1');
    expect(params).toEqual(["x'--@test.dz"]);
  });
});

describe('POST /api/newsletter — bornes', () => {
  test('400 pour une adresse de plus de 254 caractères ou non textuelle', async () => {
    expect((await request(app).post('/api/newsletter').send({ email: `${'x'.repeat(250)}@test.dz` })).status).toBe(400);
    expect((await request(app).post('/api/newsletter').send({ email: ['a@b.dz'] })).status).toBe(400);
  });
});
