// pm2 启动配置：pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'xihu-race',
      script: 'src/index.js',
      cwd: __dirname,
      node_args: '--env-file-if-exists=.env',
      max_memory_restart: '400M',
      time: true, // 日志带时间戳
    },
  ],
};
