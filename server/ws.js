const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');

// Map userId → Set of WebSocket connections
const clients = new Map();

function setup(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Authenticate via ?token= query param
    let userId = null;
    try {
      const url   = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token');
      if (token) {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        userId = payload.id;
      }
    } catch {}

    if (!userId) { ws.close(4001, 'Unauthorized'); return; }

    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId).add(ws);

    ws.on('close', () => {
      const s = clients.get(userId);
      if (s) { s.delete(ws); if (!s.size) clients.delete(userId); }
    });
    ws.on('error', () => {});
  });
}

function send(userId, data) {
  const conns = clients.get(Number(userId));
  if (!conns || !conns.size) return;
  const payload = JSON.stringify(data);
  conns.forEach(ws => { try { if (ws.readyState === 1) ws.send(payload); } catch {} });
}

module.exports = { setup, send };
