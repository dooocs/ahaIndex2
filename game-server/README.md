# 西湖飞车 · 联机服务端

跑在 ECS 上的实时联机服务（Node.js + Colyseus 0.18），由 Caddy 以 `wss://game.amazingindex.com` 对外。
和网站部署无关：改这个目录不会触发网站构建。前端游戏在 `public/race/`，设计说明见 `docs/race.md`。

## 规则

| 项目 | 规则 |
|---|---|
| 全服上限 | 同时在线 20 人（匹配中 + 比赛中 + 看结算），满了新玩家会收到「当前已有 20 人在玩，请稍后再来」 |
| 每局人数 | 2–4 人，自动匹配，优先进人多的房间 |
| 开局 | 凑够 2 人后再等 8 秒看有没有人加入；满 4 人立即开始。随后锁房，倒计时 4 秒发车 |
| 圈数 | 2 圈，和单机模式一致 |
| 判定 | 服务器按顺序检测 20 道检查门（只认正向穿过），自己计圈、记每圈用时、判冲线；超速/瞬移的那段移动不计检查门，累计 3 次异常本局不记成绩；两圈少于 120 秒不记成绩 |
| 收车 | 所有人完赛，或第一名冲线后 30 秒，或单局满 10 分钟 |
| 掉线 | 保留座位 20 秒，客户端自动重连回原房间 |
| 成绩 | 写入社区库的 `race_mp_results`（`sql/race/003_race_mp_results.sql`），浏览器只读 |
| 身份 | 和单机榜相同：浏览器本地密钥 `race.player`，服务器只存它的 sha256 作为 `player_id`；不带密钥的玩家能比赛但不写库 |

## 部署到 ECS

前提：ECS 上已装好 Node 22、pm2 和 Caddy，Caddy 把 `game.amazingindex.com` 转发到 `localhost:2567`。

```bash
# 1. 在 Mac 上，从仓库打包这个目录并传到服务器（IP 换成 ECS 公网 IP）
cd ahaIndex2 && tar --exclude node_modules --exclude .env -czf game-server.tar.gz game-server
scp game-server.tar.gz root@<ECS公网IP>:/opt/

# 2. 在 ECS 上解压、安装依赖（ECS 上 npm 镜像已设为 npmmirror，速度正常）
cd /opt && tar -xzf game-server.tar.gz && cd game-server
npm ci --omit=dev

# 3. 填配置（只要 URL 和 ServiceKey）
cp .env.example .env && vi .env

# 4. 停掉旧的测试服务，启动正式服务
pm2 delete game
pm2 start ecosystem.config.cjs && pm2 save
pm2 logs xihu-race --lines 20 --nostream   # 看到「联机服务已启动」「成绩写库：已配置 Supabase」就好了
```

以后更新：重新打包上传解压覆盖，`npm ci --omit=dev && pm2 restart xihu-race`。`.env` 不在压缩包里，不会被覆盖。

建表：在社区库的 SQL Editor 里执行 `sql/race/003_race_mp_results.sql`，再执行 `003_race_mp_results.test.sql` 自检。
如果阿里云 Supabase 开了 IP 白名单，要把 ECS 的公网 IP 加进去，否则写不了成绩。

## 验证

- 手机和电脑同时打开 `https://game.amazingindex.com/test`，点「开始匹配」，能看到对方的车在动就说明整条链路通了
- `https://game.amazingindex.com/status` 返回当前在线人数
- `npm test`：判定单测（沿真实西湖中心线跑，含贴边、抄近路、倒开、网络抖动）+ 多人仿真（匹配、开局、名次、全服上限、掉线重连、防瞬移、房间回收），约 1 分钟
- `npm run test:xihu`：两个模拟玩家在西湖赛道上跑满 2 圈，检查写库的成绩行，约 2 分半

## 赛道数据

`src/tracks/xihu.json` 由 `npm run export:track` 从 `public/race/js/layout.js` + `track.js` 生成：
20 道检查门（每约 210 米一道，最后一道是平海路的起终点线）、与 `main.js` 的 `gridSlot(0..3)` 相同的 4 个发车位。
**游戏赛道一改，就要重新导出并部署服务端**，否则服务器的检查门和画面对不上，玩家会过不了门、无法完赛。

坐标与游戏一致：水平面 `x`（东）/ `z`（南），朝向 `rot` 就是游戏里的 `h`，前进方向 `(sin h, cos h)`。

## 前端接入

`public/client/xihu-race-net.js`（服务端也在 `/client/xihu-race-net.js` 提供，允许站点跨域加载）：

```js
const net = createRaceNet({
  Client: Colyseus.Client,                 // /sdk/colyseus.js 提供的全局，或 npm 的 @colyseus/sdk
  endpoint: 'https://game.amazingindex.com',
  name: nickname,
  playerKey: localStorage.getItem('race.player'),
});
net.on('phase', (phase) => { /* waiting / countdown / racing / finished */ });
net.on('finish', (m) => { /* m.isMe、m.place、m.finishMs、m.lapMs */ });
net.on('results', (m) => { /* 结算表 */ });
await net.findMatch();

// 每帧
net.sendState({ x: car.x, y: car.y, z: car.z, rot: car.h, speed: car.s });   // 自动限频 20 次/秒
// 按 R 复位那一帧：net.sendState({ ..., respawn: true })
for (const r of net.racers()) {
  if (!r.isMe && !r.left) drawKart(r.sessionId, net.getRemotePose(r.sessionId));   // 已插值
}
```
