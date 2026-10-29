# QQ堂 · 泡泡派对 Web

一个可在浏览器直接游玩的 QQ 堂玩法致敬项目：原创 Canvas 卡通角色与地图、单人 AI 练习、2–4 人房间联机、泡泡连锁爆炸、道具成长、困泡与自救。项目与腾讯无关，不使用官方游戏客户端或服务器。

## 已实现的玩法

- 四种角色外观，属性一致；糖果、森林、冰雪三种地图主题。
- 15 × 11 格地图，固定墙体、可炸箱子、随机道具和安全出生区域。
- 泡泡约 2.2 秒后产生十字水波，遇墙阻挡，炸开箱子并触发连锁引爆。
- 泡泡数量、爆炸范围、移动速度和护盾道具。
- 被水波命中后困泡约 4 秒；每局可用一次救命针，敌人接触困泡玩家会将其淘汰。
- 最后存活者获胜；每局最多 3 分钟。
- 单人练习由浏览器运行，搭配 3 个 AI；联机由服务器裁决，空位可由 AI 补齐。
- 创建房间、6 位房间码、邀请链接、准备、房主开始、聊天、离开、房主转移和再次开局。

## 操作

| 操作 | 键盘 / 触控 |
| --- | --- |
| 移动 | WASD 或方向键；移动端方向按钮 |
| 放置泡泡 | 空格；移动端“放泡泡” |
| 使用救命针 | E；移动端“自救” |
| 音效 | 页面右上角扬声器按钮 |
| 全屏 | 游戏区域右上角全屏按钮 |

创建房间后把邀请链接或房间码发给朋友。其他玩家点击准备，房主开始游戏。比赛开始后不接受新玩家插入本局；可等待结束后加入。建议在同一台电脑使用两个独立浏览器窗口验证联机，正式与朋友游玩需共同访问同一个公开部署地址。

## 技术结构

- React + TypeScript + Vinext/Vite，采用 App Router 文件结构。
- Canvas 2D 绘制地图、角色、泡泡、水波和动态效果；Web Audio 合成音效。
- Cloudflare Worker 运行房间 API，Cloudflare D1 保存房间状态。
- Drizzle 定义表结构并生成 SQL migration；房间读写使用 D1 prepared statements。
- `lib/game.ts` 是浏览器与服务端共用的确定性游戏引擎。
- `lib/rooms.ts` 负责身份、房间规则、服务器推进、输入校验和并发控制。
- `lib/renderer.ts` 负责渲染，`app/page.tsx` 负责界面与输入。
- `app/api/rooms/` 提供联机 API，`db/schema.ts` 定义持久化结构。

联机使用 **HTTP 轮询，不使用 WebSocket**。对局中客户端发送操作并读取快照，每次响应后约 90ms 发起下一次请求；实际间隔还包含网络往返时间。等待房间约 700ms 刷新，大厅约 8 秒刷新。服务器按 50ms 逻辑步长补算，客户端不能提交坐标、胜负或炸弹结果。

房间单行 JSON 搭配 `version` 条件更新，避免同时加入、准备或操作时覆盖其他玩家的写入。输入带递增 `seq` 去重，超过 400ms 未更新的方向输入停止生效。断开超过 60 秒的玩家会在其他请求触发时移出房间，对局中视为离开，房主自动转交给仍在线的真人玩家。

## 本地安装与启动

已在 Node.js 24.22.0 环境验证。建议使用 Node.js 24；项目依赖最低要求为 Node.js 22.13.0。Windows PowerShell 如因脚本策略无法执行 `npm`，可将命令中的 `npm` 换成 `npm.cmd`。

在项目根目录执行一次依赖安装：

```sh
npm run install:ci
```

不要同时启动多个依赖安装进程。项目保留 `package-lock.json`，安装脚本使用锁文件；不需要另行安装全局 Vinext、Wrangler 或 Drizzle。

`.openai/hosting.json` 中需要保留数据库声明：

```json
{
  "d1": "DB",
  "r2": null,
  "project_id": "你的 Sites 项目 ID"
}
```

现有文件已经配置好此项目的 ID，无需自行替换。游戏不需要 R2 存储。

先生成数据库 migration（如果仓库已经包含与当前 schema 一致的 migration，此步骤不会产生新 SQL），再构建：

```sh
npm run db:generate
npm run build
```

构建产物中的 `dist/server/wrangler.json` 用于本地 Worker 及 D1 配置。绑定发生变化后需要重新构建。

### 首次初始化本地 D1

本地数据库在 `.wrangler/state`，开发预览与构建预览共享它。首次使用全新本地数据库时，按文件名顺序执行 `drizzle/` 中的 SQL。以下为 PowerShell 命令：

```powershell
Get-ChildItem -LiteralPath ./drizzle -Filter *.sql | Sort-Object Name | ForEach-Object {
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file $_.FullName
  if ($LASTEXITCODE -ne 0) { throw "数据库初始化失败，请查看上方错误" }
}
```

macOS/Linux 可执行：

```sh
for migration in drizzle/*.sql; do
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file "$migration" || exit 1
done
```

**上述批量命令仅用于首次初始化空数据库。** 已有本地数据时，只执行尚未应用的新 SQL；重复运行建表 migration 会报表已存在。应用单个 migration 的命令如下，将文件名替换为实际待执行文件：

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/待执行迁移.sql
```

不要把持久化路径改成 `.wrangler/state/v3`，Wrangler 会自行添加版本目录。服务请求期间不会临时执行建表语句。

### 开发与构建预览

开发模式带热更新，默认从 5173 端口启动，使用终端实际打印的地址：

```sh
npm run dev
```

需要验证正式 Worker 构建时：

```sh
npm run build
npm start
```

`npm start` 默认监听本机 `127.0.0.1`，不会发布到公网。指定端口可用 `npm start -- --port 8787`。缺少 D1 binding 或 migration 时，单人练习仍可运行，联机接口会返回服务不可用；应检查服务器日志和上述初始化步骤。

## 测试与检查

```sh
node --test scripts/game.test.mjs scripts/rooms.test.mjs
node node_modules/typescript/bin/tsc --noEmit --pretty false
npm run build
```

游戏测试覆盖地图生成、移动、连锁、困泡、自救、道具和胜负等规则。房间测试运行实际 SQLite SQL，覆盖并发加入和输入竞态、鉴权与私密字段、准备和开局、退出与重赛、服务器时间、过期输入、断线房主转移、聊天限制、过期清理及非法请求。Node 可能打印原生 TypeScript/SQLite 的实验特性提示，这不是测试失败。

联机人工验收：打开两个浏览器窗口，分别创建和加入同一房间；准备后开局，确认双方能看见移动与放泡泡；验证其中一方离开、房主转移和再次开局。单人练习不依赖 API，可单独验收。

## API

所有响应为 JSON，使用 `Cache-Control: no-store`。错误格式为 `{ "error": "提示文字" }`，状态码包括 400、401、403、404、409、413、429 和 503。

| 路径 | 请求 | 结果 |
| --- | --- | --- |
| `GET /api/rooms` | 无 | `{rooms:[...]}`，仅列出有空位、未开局且有活跃玩家的房间 |
| `POST /api/rooms` | `{name,character,map}` | `{code,token,playerId,room}` |
| `GET /api/rooms/:code` | 可选 `?token=...` | `{room,playerId?}` |
| `POST /api/rooms/:code` | `{action:"join",name,character,token?}` | `{code,token,playerId,room}` |
| 同上 | `{action:"ready",token,ready:true}` | 更新后的房间 |
| 同上 | `{action:"start",token,addBots:true}` | 房主开局；电脑补齐至 4 人 |
| 同上 | `{action:"input",token,seq,dx,dy,bomb?,rescue?}` | 权威快照；轴值归一为 -1、0、1 |
| 同上 | `{action:"chat",token,text}` | 房间消息；最多 100 字，每人间隔至少 1 秒 |
| 同上 | `{action:"leave",token}` | 离开后的房间及自动转移房主 |

`character` 可为 `blue`、`pink`、`orange`、`mint`；`map` 可为 `candy`、`forest`、`snow`。昵称最长 12 个 UTF-16 码元，请求体最多 4096 字节。客户端 `seq` 应持续递增，刷新恢复会话时也不能从旧序号之前重新开始；可从 `Date.now()` 初始化。

公开 `room` 包含房间号、房主 ID、地图、状态、玩家公开资料、游戏快照、最近 30 条聊天、版本和服务器时间。它不包含任何玩家 token、私有输入或鉴权记录。`token` 是当前玩家的能力凭证，只有创建/加入成功时单独返回；携带已知 token 再次加入可恢复仍存在的身份。

## 部署与联网范围

本项目面向 Sites/Cloudflare Worker + D1 环境。使用 Sites 发布流程时，保留 `.openai/hosting.json` 中的 `"d1":"DB"`、`db/schema.ts` 和 `drizzle/` migration，平台会配置真实绑定并处理生产数据库迁移。本地 `.wrangler` 数据不会自动上传成生产房间。发布成功后，玩家应共同访问同一个公开 HTTPS 地址，使用同一个房间码。

如果自行部署到 Cloudflare，需要创建自己的 D1 数据库，将构建配置中的示例数据库 ID 换成真实部署配置，绑定名保持 `DB`，先应用未执行的生产 migration 再部署 Worker 和静态资源。不要将本地占位数据库 ID 当作真实线上数据库。本仓库的默认 `npm start` 只做本地预览。

局域网测试需要显式让预览 Worker 监听局域网接口，朋友访问运行电脑的局域网 IP 与端口，并允许相应的系统防火墙连接。示例（仅用于受信任局域网测试）：

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --local --persist-to .wrangler/state --ip 0.0.0.0 --port 8787 --inspector-port 0
```

这不会提供公网域名或穿透路由器。局域网 HTTP 下部分浏览器会限制剪贴板等功能，可手动输入房间码。跨网络与朋友对战应使用公开 HTTPS 部署。

**不能将本项目直接当成纯静态站或普通 Node/Express 服务托管后获得联机能力。** 房间 API 依赖 `cloudflare:workers` 与 D1；换成普通 VPS/Node 后端需要实现等价的数据库连接、身份验证及并发写入适配。纯静态托管只能保留不依赖服务端的练习部分。

## 数据与隐私

- 昵称、角色和音效偏好保存在当前浏览器；加入房间时昵称、角色以及聊天会同步给该房间的其他玩家，并暂存在服务端。
- 房间无需注册，不收集邮箱、手机号或 QQ 账号。房间号和公开快照用于邀请与大厅发现，房间并非私密聊天空间。
- 分享链接只包含房间码。请不要分享自己的 token；它可代表你进行准备、操作、聊天或离开。
- D1 私有房间记录保存玩家 token、操作序号及最近输入；这些字段不会出现在公开快照。
- 房间连续 30 分钟没有状态更新后不可访问；后续创建房间会分批清理过期数据，因此物理删除并非在第 30 分钟准时发生。
- 本项目没有主动设置分析追踪；部署平台仍可能记录正常的访问日志。请避免在房间聊天中发送个人敏感信息。

## 与官方 QQ 堂的差异及当前边界

这是可玩的原创网页版致敬实现，并非官方客户端的完整移植。角色、地图与动画由代码原创绘制，没有复刻官方素材文件；保留了糖果风格、格子移动、定时泡泡、十字水波、连锁、道具和困泡等核心体验。

目前只有四种角色外观、三种地图主题、自由对战与 AI 练习；不包含官方全部角色、商城、账号等级、排位、战队、任务、特殊模式、完整技能和原版音效。所有角色能力相同。

联机定位为小规模好友房：HTTP 轮询的操作反馈受网络往返时间影响，尚未实现 WebSocket、客户端预测、回滚或专业匹配系统。服务器由请求触发计算，并非持续运行的游戏进程；所有客户端停止请求时不会持续后台模拟，下一次请求最多补算 3 秒，以限制单次工作量。网络中断或浏览器后台节流可能影响操作连续性。需要大规模运营时，应进一步改为专用实时房间服务或 Durable Objects，并进行容量与网络质量测试。
