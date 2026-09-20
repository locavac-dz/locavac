const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');

// Map userId → Set of WebSocket connections
const clients = new Map();

const AUTH_TIMEOUT_MS = 5000;
const MAX_PAYLOAD     = 16 * 1024; // les messages temps réel sont minuscules : 16 Kio suffisent largement

function register(userId, ws) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(ws);
}

function setup(server, { authTimeoutMs = AUTH_TIMEOUT_MS } = {}) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_PAYLOAD });

  wss.on('connection', ws => {
    // Le jeton n'est jamais lu dans l'URL (il finirait dans les journaux du proxy) :
    // le client l'envoie dans son premier message { type: 'auth', token }.
    let userId = null;
    let authenticating = false;
    const authTimer = setTimeout(() => { if (!userId) ws.close(4001, 'Unauthorized'); }, authTimeoutMs);

    ws.on('message', async raw => {
      let data;
      try { data = JSON.parse(raw); } catch { return; }

      if (!userId) {
        if (authenticating) return;
        if (data?.type !== 'auth' || typeof data.token !== 'string') return ws.close(4001, 'Unauthorized');
        authenticating = true;
        try {
          const payload = jwt.verify(data.token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
          // Même contrôle que le middleware HTTP : compte existant et non banni
          const r = await pool.query('SELECT id, banned FROM users WHERE id = $1', [payload.id]);
          if (!r.rows[0] || r.rows[0].banned) throw new Error('compte désactivé');
          userId = payload.id;
          clearTimeout(authTimer);
          register(userId, ws);
          ws.send(JSON.stringify({ type: 'auth_ok' }));
        } catch {
          ws.close(4001, 'Unauthorized');
        } finally {
          authenticating = false;
        }
        return;
      }

      // Relayer les événements de frappe au destinataire
      if (data?.type === 'typing' && data.to) {
        send(Number(data.to), { type: 'typing', from: userId, listing_id: data.listing_id });
      }
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      const s = clients.get(userId);
      if (s) { s.delete(ws); if (!s.size) clients.delete(userId); }
    });
    ws.on('error', () => {});
  });

  return wss;
}

function send(userId, data) {
  const conns = clients.get(Number(userId));
  if (!conns || !conns.size) return;
  const payload = JSON.stringify(data);
  conns.forEach(ws => { try { if (ws.readyState === 1) ws.send(payload); } catch {} });
}

module.exports = { setup, send };
