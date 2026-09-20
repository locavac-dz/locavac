const { EventEmitter } = require('events');
const { installGracefulShutdown } = require('../../server/lifecycle');

function setup({ serverClose, poolEnd, timeoutMs = 8000 } = {}) {
  const order = [];
  const proc = new EventEmitter();
  proc.exit = jest.fn(code => order.push(`exit(${code})`));
  const clients = [{ close: jest.fn(() => order.push('client.close')) }, { close: jest.fn(() => order.push('client.close')) }];
  const wss    = { clients: new Set(clients), close: jest.fn(cb => { order.push('wss.close'); cb(); }) };
  const server = { close: jest.fn(serverClose || (cb => { order.push('server.close'); cb(); })) };
  const pool   = { end: jest.fn(poolEnd || (() => { order.push('pool.end'); return Promise.resolve(); })) };
  const log    = jest.fn();
  installGracefulShutdown({ server, wss, pool, proc, log, timeoutMs });
  return { proc, server, wss, pool, clients, order, log };
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('Arrêt propre du serveur', () => {
  test.each(['SIGTERM', 'SIGINT'])('%s : WebSockets, puis HTTP, puis PostgreSQL, puis exit(0)', async signal => {
    const s = setup();
    s.proc.emit(signal);
    await flush();
    expect(s.order).toEqual(['client.close', 'client.close', 'wss.close', 'server.close', 'pool.end', 'exit(0)']);
  });

  test('les clients WebSocket reçoivent le code 1001 (serveur qui redémarre) : le navigateur se reconnecte', async () => {
    const s = setup();
    s.proc.emit('SIGTERM');
    await flush();
    for (const c of s.clients) expect(c.close).toHaveBeenCalledWith(1001, expect.any(String));
  });

  test('un second signal pendant l\'arrêt est ignoré (pas de double fermeture du pool)', async () => {
    const s = setup();
    s.proc.emit('SIGTERM');
    s.proc.emit('SIGINT');
    await flush();
    expect(s.pool.end).toHaveBeenCalledTimes(1);
    expect(s.proc.exit).toHaveBeenCalledTimes(1);
  });

  test('une connexion qui ne se ferme jamais : sortie forcée exit(1) après le délai', async () => {
    jest.useFakeTimers();
    try {
      const s = setup({ serverClose: () => {}, timeoutMs: 8000 });
      s.proc.emit('SIGTERM');
      await flush();
      expect(s.proc.exit).not.toHaveBeenCalled();
      jest.advanceTimersByTime(8000);
      expect(s.proc.exit).toHaveBeenCalledWith(1);
      expect(s.pool.end).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
  });

  test('erreur à la fermeture du pool : exit(1), erreur journalisée', async () => {
    const s = setup({ poolEnd: () => Promise.reject(new Error('pool déjà fermé')) });
    s.proc.emit('SIGTERM');
    await flush();
    expect(s.proc.exit).toHaveBeenCalledWith(1);
    expect(s.log.mock.calls.flat().join(' ')).toMatch(/pool déjà fermé/);
  });

  test('fonctionne sans serveur WebSocket', async () => {
    const proc = new EventEmitter(); proc.exit = jest.fn();
    const server = { close: cb => cb() }, pool = { end: jest.fn().mockResolvedValue() };
    installGracefulShutdown({ server, pool, proc, log: jest.fn() });
    proc.emit('SIGTERM');
    await flush();
    expect(proc.exit).toHaveBeenCalledWith(0);
  });
});
