module.exports = {
  apps: [{
    name: 'bot-revendedores',
    script: './index.js',

    // === CONFIGURAÇÕES OTIMIZADAS PARA SEU SERVIDOR ===
    // 8GB RAM + 3 cores = configuração agressiva

    instances: 1, // WhatsApp-web.js não suporta cluster
    exec_mode: 'fork',

    // Memória - seu servidor tem 8GB, pode usar até 6GB
    max_memory_restart: '6G',

    // Node.js otimizado para servidor potente
    node_args: [
      '--max-old-space-size=4096', // 4GB para Node.js
      '--optimize-for-size',
      '--gc-interval=100',
      '--max-semi-space-size=128'
    ],

    // Reinicialização inteligente
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,

    // Logs otimizados
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    max_log_size: '100M',
    max_log_files: 5,

    // Variáveis de ambiente para servidor potente
    env: {
      NODE_ENV: 'production',
      DEBUG_MODE: 'false',
      VERIFICACAO_INTERVAL: '3600000', // 1 hora
      MAX_HISTORICO_MENSAGENS: '200',
      MAX_CONCURRENT_REQUESTS: '15'
    },

    // Modo desenvolvimento (se necessário)
    env_development: {
      NODE_ENV: 'development',
      DEBUG_MODE: 'true',
      VERIFICACAO_INTERVAL: '1800000', // 30 min
      MAX_HISTORICO_MENSAGENS: '100',
      MAX_CONCURRENT_REQUESTS: '10'
    },

    // Monitoramento
    monitoring: true,
    pmx: true,

    // Auto restart em horários específicos (opcional)
    cron_restart: '0 4 * * *', // 4h da manhã diariamente

    // Ignorar arquivos para watch
    ignore_watch: [
      'node_modules',
      'logs',
      '*.json',
      '.wwebjs_cache',
      '.wwebjs_auth',
      'backup_historico'
    ],

    // Watch apenas em desenvolvimento
    watch: false,

    // Configurações avançadas para servidor SSD
    kill_timeout: 5000,
    listen_timeout: 3000,

    // Configurações específicas para WhatsApp bot
    merge_logs: true,
    combine_logs: true
  }]
};