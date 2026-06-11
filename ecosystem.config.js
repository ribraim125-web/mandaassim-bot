module.exports = {
  apps: [{
    name: 'mandaassim-bot',
    script: 'index.js',
    max_memory_restart: '400M',   // reinicia se vazar memória
    // NUNCA desiste de reiniciar (2 semanas sem supervisão): em vez de parar
    // após N falhas, usa backoff exponencial (5s → 10s → 20s... máx 5 min).
    // Crash-loop vira espera crescente, não morte permanente do bot.
    exp_backoff_restart_delay: 5000,
    max_restarts: 9999,
    min_uptime: '10s',            // não conta restart se morreu antes de 10s de uptime
    kill_timeout: 8000,           // tempo para SIGTERM fechar a porta antes do SIGKILL
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
