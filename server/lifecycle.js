// Arrêt propre sur SIGTERM/SIGINT (pm2 reload, redémarrage du VPS) : on cesse d'accepter des connexions,
// on laisse les requêtes en cours se terminer, puis on ferme WebSockets et pool PostgreSQL.
function installGracefulShutdown({ server, wss, pool, timeoutMs = 8000, proc = process, log = console.log }) {
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`[Arrêt] ${signal} reçu — fermeture propre…`);

    // Filet de sécurité : une connexion qui traîne ne doit pas bloquer le redémarrage
    const force = setTimeout(() => { log('[Arrêt] Délai dépassé — sortie forcée.'); proc.exit(1); }, timeoutMs);
    if (force.unref) force.unref();

    try {
      if (wss) {
        for (const client of wss.clients || []) { try { client.close(1001, 'Redémarrage du serveur'); } catch {} }
        await new Promise(resolve => wss.close(() => resolve()));
      }
      await new Promise(resolve => server.close(() => resolve()));
      if (pool) await pool.end();
      clearTimeout(force);
      log('[Arrêt] Terminé.');
      proc.exit(0);
    } catch (err) {
      clearTimeout(force);
      log('[Arrêt] Erreur pendant la fermeture : ' + err.message);
      proc.exit(1);
    }
  }

  proc.on('SIGTERM', () => shutdown('SIGTERM'));
  proc.on('SIGINT',  () => shutdown('SIGINT'));
  return shutdown;
}

module.exports = { installGracefulShutdown };
