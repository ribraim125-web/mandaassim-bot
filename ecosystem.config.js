module.exports = {
  apps: [{
    name: 'mandaassim-bot',
    script: 'index.js',
    max_memory_restart: '400M',   // reinicia se vazar memória
    restart_delay: 5000,          // espera 5s entre restarts (porta tem tempo de fechar)
    max_restarts: 15,             // para de restartar se travar em loop
    min_uptime: '10s',            // não conta restart se morreu antes de 10s de uptime
    kill_timeout: 8000,           // tempo para SIGTERM fechar a porta antes do SIGKILL
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
