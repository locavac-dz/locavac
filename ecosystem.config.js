// pm2 ecosystem — lancer avec : pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name:         'locavac',
      script:       'server/index.js',
      instances:    'max',          // 1 worker par cœur CPU
      exec_mode:    'cluster',      // mode cluster pour load-balancing
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

      // Graceful shutdown (SIGINT → fermer les connexions proprement)
      kill_timeout:  5000,
    },
  ],
};
