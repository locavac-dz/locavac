const router = require('express').Router();
const admin  = require('../middleware/admin');
const agent  = require('../agent');

router.use(admin);

// GET /api/agent/status
router.get('/status', (req, res) => {
  res.json({
    startedAt:  agent.state.startedAt,
    lastBackup: agent.state.lastBackup,
    lastReport: agent.state.lastReport,
    lastCheck:  agent.state.lastCheck,
    checks:     agent.state.checks,
    alerts:     agent.state.alerts,
  });
});

// POST /api/agent/backup — backup manuel
router.post('/backup', (req, res) => {
  agent.doBackup();
  res.json({ ok: true, lastBackup: agent.state.lastBackup });
});

// DELETE /api/agent/alerts/:id — dismisser une alerte
router.delete('/alerts/:id', (req, res) => {
  const id = Number(req.params.id);
  const a  = agent.state.alerts.find(x => x.id === id);
  if (!a) return res.status(404).json({ error: 'Alerte introuvable.' });
  a.dismissed = true;
  res.json({ ok: true });
});

module.exports = router;
