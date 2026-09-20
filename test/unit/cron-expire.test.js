jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../../server/db', () => require('../mocks/db'));
jest.mock('../../server/mailer', () => ({ mailCheckInReminder: jest.fn(), mailReviewReminder: jest.fn() }));

const nodeCron = require('node-cron');
const db = require('../mocks/db');

let cron, logSpy;
beforeAll(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  cron = require('../../server/cron');
});
afterAll(() => logSpy.mockRestore());
afterEach(() => { db.pool.query.mockClear(); });

describe('expireUnpaidReservations — libération automatique du calendrier', () => {
  test('annule les réservations en attente de plus de 24 h, sauf virement déclaré depuis moins de 72 h', async () => {
    db.pool.query.mockResolvedValueOnce({ rows: [] });
    await cron.expireUnpaidReservations();
    const [sql, params] = db.pool.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE reservations r SET status = 'cancelled'/);
    expect(sql).toMatch(/r\.status = 'pending'/);
    expect(sql).toMatch(/r\.created_at < NOW\(\) - make_interval\(hours => \$1\)/);
    expect(sql).toMatch(/NOT EXISTS[\s\S]*p\.status = 'pending_transfer'[\s\S]*make_interval\(hours => \$2\)/);
    expect(sql).toMatch(/RETURNING r\.id/);
    expect(params).toEqual([24, 72]);
  });

  test('ne touche jamais aux réservations confirmées', async () => {
    db.pool.query.mockResolvedValueOnce({ rows: [] });
    await cron.expireUnpaidReservations();
    expect(db.pool.query.mock.calls[0][0]).not.toMatch(/'confirmed'/);
  });

  test('rien à expirer : une seule requête, retourne 0', async () => {
    db.pool.query.mockResolvedValueOnce({ rows: [] });
    expect(await cron.expireUnpaidReservations()).toBe(0);
    expect(db.pool.query).toHaveBeenCalledTimes(1);
  });

  test('les paiements encore ouverts des réservations expirées sont annulés (pas les paiements réussis ou remboursés)', async () => {
    db.pool.query.mockResolvedValueOnce({ rows: [{ id: 41 }, { id: 42 }] }).mockResolvedValueOnce({ rows: [] });
    expect(await cron.expireUnpaidReservations()).toBe(2);
    const [sql, params] = db.pool.query.mock.calls[1];
    expect(sql).toMatch(/UPDATE payments SET status = 'cancelled'/);
    expect(sql).toMatch(/status IN \('pending', 'pending_otp', 'pending_transfer'\)/);
    expect(sql).not.toMatch(/'success'|'refunded'/);
    expect(params).toEqual([[41, 42]]);
  });

  test('délais exposés : 24 h sans paiement, 72 h pour un virement', () => {
    expect(cron.UNPAID_EXPIRY_HOURS).toBe(24);
    expect(cron.TRANSFER_EXPIRY_HOURS).toBe(72);
  });
});

describe('Planification', () => {
  test('une tâche horaire unique qui commence par l\'expiration des impayés', async () => {
    expect(nodeCron.schedule).toHaveBeenCalledTimes(1);
    const [expr, job] = nodeCron.schedule.mock.calls[0];
    expect(expr).toBe('0 * * * *');
    db.pool.query.mockResolvedValue({ rows: [] });
    await job();
    expect(db.pool.query.mock.calls[0][0]).toMatch(/UPDATE reservations r SET status = 'cancelled'/);
    db.pool.query.mockReset();
    db.pool.query.mockImplementation(() => Promise.resolve({ rows: [] }));
  });

  test('une erreur SQL n\'arrête pas le processus (journalisée)', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    db.pool.query.mockRejectedValueOnce(new Error('connexion perdue'));
    await expect(nodeCron.schedule.mock.calls[0][1]()).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith('[Cron]', 'connexion perdue');
    errSpy.mockRestore();
  });
});
