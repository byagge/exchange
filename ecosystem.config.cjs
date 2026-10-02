/** PM2 — only exchange.arix.vu processes (namespaced) */
module.exports = {
  apps: [
    {
      name: 'exchange-api',
      cwd: '/var/www/exchange.arix.vu/apps/api',
      script: 'dist/main.js',
      node_args: '-r ./dist/load-env.cjs',
      instances: 1,
      autorestart: true,
      max_memory_restart: '450M',
      env: {
        NODE_ENV: 'production',
        API_HOST: '127.0.0.1',
        API_PORT: '3010',
      },
    },
    {
      name: 'exchange-bot',
      cwd: '/var/www/exchange.arix.vu/apps/bot',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
