// pm2 ecosystem — lancer avec : pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name:         'locavac',
      script:       'server/index.js',
      // instances: 'max' désactivé — le WebSocket maintient une Map en mémoire par worker.
      // En cluster multi-process, un send() vers un client connecté sur un autre worker
      // échoue silencieusement. Passage à Redis Pub/Sub requis avant de repasser à 'max'.
      instances:    1,
      exec_mode:    'cluster',
      watch:        false,
      max_memory_restart: '512M',

      env: {                        // développement local
        NODE_ENV:     'development',
        PORT:          3000,
      },

      env_production: {             // pm2 start ... --env production
        NODE_ENV:     'production',
        PORT:          3000,
        // Les variables sensibles sont lues depuis le fichier .env
        // Ne jamais mettre JWT_SECRET ou DATABASE_URL ici en clair
      },

      log_file:     'logs/locavac-combined.log',
      error_file:   'logs/locavac-error.log',
      out_file:     'logs/locavac-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // Relance automatique si le process plante
      autorestart:  true,
      restart_delay: 3000,

      // Rechargement sans coupure : le nouveau processus signale « ready » après listen() (server/index.js) ;
      // l'ancien reçoit alors SIGINT et ferme proprement HTTP, WebSockets et pool PostgreSQL (server/lifecycle.js).
      wait_ready:     true,
      listen_timeout: 20000, // schéma + migrations au démarrage
      kill_timeout:   10000, // > délai d'arrêt propre (8 s)
    },
  ],
};
