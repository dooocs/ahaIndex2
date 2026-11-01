import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import express from 'express';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { config, supabaseEnabled } from './config.js';
import { RaceRoom } from './RaceRoom.js';
import { TRACKS } from './tracks.js';
import { stats } from './stats.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdkBundle = path.join(path.dirname(require.resolve('@colyseus/sdk/package.json')), 'dist', 'colyseus.js');

function allowCors(req, res) {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
}

const server = new Server({
  greet: false,
  transport: new WebSocketTransport({
    pingInterval: 5000, // 5 秒心跳，及时发现手机切后台、断网
    pingMaxRetries: 2,
  }),
  express: (app) => {
    app.get('/', (_req, res) => res.type('text').send('西湖飞车联机服务运行中'));
    app.get('/health', (_req, res) => res.json({ ok: true }));
    app.get('/favicon.ico', (_req, res) => res.status(204).end());

    // 前端匹配前可以先查：当前几人在线、是否已满
    app.get('/status', (req, res) => {
      allowCors(req, res);
      res.setHeader('Cache-Control', 'no-store');
      res.json(stats.snapshot(config.maxPlayersGlobal));
    });

    app.get('/tracks/:id', (req, res) => {
      allowCors(req, res);
      const track = TRACKS[req.params.id];
      if (!track) return res.status(404).json({ error: 'not found' });
      res.json(track);
    });

    // 联机测试页及其依赖
    app.get('/test', (_req, res) => res.sendFile(path.join(root, 'public', 'test.html')));
    // 客户端 SDK 和联机模块：允许站点跨域以 ES module 方式加载
    app.get('/sdk/colyseus.js', (req, res) => {
      allowCors(req, res);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.sendFile(sdkBundle);
    });
    app.use('/client', (req, res, next) => { allowCors(req, res); next(); },
      express.static(path.join(root, 'public', 'client'), { maxAge: '5m' }));
  },
});

server
  .define('xihu_race', RaceRoom)
  .filterBy(['track']) // 不同赛道的玩家不会被匹配到一起
  .sortBy({ clients: -1 }); // 优先塞进人多的房间，尽快凑满开局

await server.listen(config.port);
console.log(`西湖飞车联机服务已启动：端口 ${config.port}，全服上限 ${config.maxPlayersGlobal} 人，每局 ${config.minPlayersPerRace}-${config.maxPlayersPerRace} 人`);
console.log(supabaseEnabled() ? '成绩写库：已配置 Supabase' : '成绩写库：未配置 Supabase，只打印日志');
