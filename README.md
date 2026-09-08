# FocusSpace

各自学习，一起专注。MVP 已完成账号与私人房间、共享 Focus/Break、私有任务与休息聊天、结算、3D 自习室、本地雨声，以及异常恢复和单实例生产交付。实现依据见 `Doc` 中的 PRD 与开发设计文档。

## 环境与开发启动

需要 Node.js **22.12+**（本次验证为 24.19.0）、npm，以及可写的本地磁盘；无需安装数据库服务。以下命令均在项目根目录执行：

```powershell
npm ci
npm run setup
npm run dev
```

访问 [http://localhost:5173](http://localhost:5173)。`setup` 只在缺少 `.env` 时复制示例，生成 Prisma Client、建立数据库目录、应用已有迁移并构建共享包；重复执行保留配置和数据。Vite 代理 `/api`、`/socket.io` 到 `.env` 的 `PORT`。始终使用同一个主机名，`localhost` 与 `127.0.0.1` 不共享登录 Cookie。

## 生产启动与更新

首次安装同样先执行 `npm ci`、`npm run setup`，再运行：

```powershell
npm run typecheck
npm run build
npm start
```

访问 [http://localhost:3001](http://localhost:3001)。`npm start` 设置生产模式，由同一个 Node 进程提供页面、音频、HTTP API 和 Socket.IO，支持房间与 Summary 深链接刷新；缺少构建产物会明确报错。端口被占用时停止原服务，或修改 `PORT` 和 `APP_ORIGINS`。停止服务使用 Ctrl+C。

更新前先备份、停止旧进程，再执行 `npm ci`、`npm run setup`、`npm run build`、`npm start`。保留 `.env` 和数据库目录，**不要使用 migrate reset、db push --force-reset 或删除数据库**。本阶段迁移只增加两个可空字段和索引，并回填幂等凭据的房间关联，不重建数据库。已有第三阶段数据可直接升级。

单独应用已提交的增量迁移：

```powershell
npm run db:deploy
```

开发新迁移用 `npm run db:migrate -- --name <名称>`，提交生成的 `prisma/migrations`。`db:migrate` 用于开发，生产只用 `setup` 或 `db:deploy`。Windows 如遇 Prisma 引擎文件占用，先停止本项目旧 Node 服务再执行 `setup`。

## 配置与持久化

`.env.example` 是配置模板；实际 `.env`、数据库、备份和验证产物均不提交 Git。默认数据库是 `prisma/data/focusspace.db`，独立于 `dist`，构建和重启不会清空。正式部署建议将 `DATABASE_URL` 指向应用更新目录之外的持久化目录。

| 变量 | 默认值 / 用途 |
| --- | --- |
| `DATABASE_URL` | `file:./data/focusspace.db`，相对 `prisma/`；可用绝对路径，如 `file:D:/FocusSpaceData/focusspace.db` 或 `file:/srv/focusspace-data/focusspace.db` |
| `HOST` / `PORT` | `127.0.0.1` / `3001`；需要对外监听时显式设 `HOST=0.0.0.0` |
| `APP_ORIGINS` | 逗号分隔的完整浏览器来源；示例包含本地开发与生产。改端口、域名后须同步修改 |
| `COOKIE_SECURE` | 本地 HTTP 为 `false`，HTTPS 为 `true` |
| `SESSION_DAYS` | 登录有效期，默认 7 天 |
| `DISCONNECT_GRACE_MS` | 断线保留时间，默认 60000 毫秒；范围 1000–300000 |
| `DEMO_MODE` | 默认 `false`；`true` 开放已有的 45/15 秒节奏和显式演示账号初始化 |

仅运行 **一个服务进程**，不使用 cluster、多副本或多个进程共享数据库。HTTPS 反向代理需转发 WebSocket Upgrade，设置大于心跳周期的连接超时，并配置真实网页来源。当前没有公网部署目标，交付本地生产运行及部署文件。

## 两人短演示

先在 `.env` 设置 `DEMO_MODE=true`，执行并保存终端显示的新账号密码：

```powershell
npm run demo:init
npm start
```

命令创建 `focus_demo_1`、`focus_demo_2`、`focus_demo_3` 三个普通用户，每人使用独立随机密码。已有同名账号会跳过，不修改密码、房间或记录，不创建管理员。需要另一组时执行 `npm run demo:init -- classroom`。关闭演示开关不会删除这些账号；正式模式仍可正常注册。

1. 用两个独立浏览器配置或普通窗口与无痕窗口登录账号 1、2（可加第三人）。普通标签页共享 Cookie，不能模拟独立账号。
2. A 创建“期末复习房”，点击「使用 45/15 秒演示节奏」；B 输入房间码加入。两端各添加一项任务，点击准备，A 开始共学。
3. Focus 中 B 完成任务，A 立即看到公开进度；聊天保持锁定。A 点击播放雨声，B 的声音不受影响；B 刷新，恢复同一轮及剩余时间。
4. 45 秒后进入 Break，B 发一条消息；15 秒后自动进入第 2 轮 Focus。
5. A 结束共学，两端查看结果；点击「打开已保存结果」并刷新。返回「我的空间」可以创建或加入下一间房。

演示通常约 2 分钟。服务端重启演练请使用独立数据库：可直接运行下述 `test:delivery`，它不会触碰日常数据。

## 恢复与数据保留

- 服务重启按原阶段边界追赶，不重置计时。旧个人参与区间按最后持久化心跳关闭，停机时间不计入专注；成员重新连接确认后才继续个人计时。
- 重启时原在线成员获得一次恢复宽限，截止时间持久化；原已断线成员沿用原截止时间，反复重启不续期。房主超时按截止时间结束，结算事务和唯一键防止重复结果。
- 数据库失败时不显示虚假成功、不误退出账号或移除成员；输入保留，页面可重试连接、提交或读取 Summary。失败的断线写入会自动重试，先关闭旧参与区间再允许重连。
- 聊天及其幂等回执正文超过 24 小时后清理，回执保留过期标记以阻止重放。已结束房间的操作凭据在结束及请求都超过 7 天后清理；活动房间的凭据保留。清理在启动时及每分钟执行。到期登录令牌同时清理。
- 账号、房间、任务、阶段、参与区间与结算长期保留；本期没有自动删除学习记录的规则。

## 备份与恢复

运行中或停机后均可执行一致性备份；备份包含已提交的 WAL 数据，输出为独立 SQLite 文件。已有目标文件不会覆盖：

```powershell
npm run db:backup
# 或显式指定新文件名
npm run db:backup -- backups/before-update.db
```

恢复时停止应用，将备份复制到一个**新的**数据库路径，例如：

```powershell
Copy-Item -LiteralPath .\backups\before-update.db -Destination .\prisma\data\restored.db
```

先确认目标 `restored.db` 不存在；将 `.env` 的 `DATABASE_URL` 改为 `file:./data/restored.db`，执行 `npm run db:deploy`、`npm start`。确认账号和结果后再决定如何保留旧库。不要把备份覆盖到还在使用或残留 WAL 的旧库上。手工文件备份必须停机后复制整个数据目录，不能运行中只复制主 `.db` 而遗漏 WAL。备份含账号摘要、任务和聊天，应按应用数据保管。

## 验证与资源

```powershell
npm run typecheck
npm run build
npm run test:delivery
```

`test:delivery` 创建独立 `.tmp/delivery-*` 数据库和空闲端口，使用与 `npm start` 一致的生产入口，验证重启、故障补偿、两浏览器 45/15 秒核心流程、3D/音频资源、导航、数据保留与备份恢复，并保存截图和结果。Windows 自动使用已安装 Edge；其他机器先执行 `npx playwright install chromium`。测试会停止自己的进程，不停止日常服务。已有 `test:flow`、`test:session`、`test:space` 保留供对应能力变更时使用，不要求每次全量重复。

3D 家具、Avatar 和页面装饰均为本项目代码生成，无外部模型、图片或字体；Three.js 使用 MIT 许可。雨声为本项目原创程序合成，脚本与 WAV 按 CC0-1.0 提供，无录音采样。来源和许可见 [资源记录](Doc/资源来源与授权.md)；重建音频执行 `npm run audio:generate`。

具体第四阶段验证结果见 [交付记录](Doc/阶段交付_恢复部署与MVP.md)。已知限制：单实例、每房 8 人、每房一次 Session、房主不转移；无聊天历史补发、个人历史列表及 P1 扩展。异常中止最多丢失最后一段未持久化心跳之间的有效时长（通常不超过约 15 秒），采用保守统计。未实测实体低端手机、Safari/iOS 和公网 HTTPS 代理；WebGL 不可用时仍可使用座位卡片完成共学，移动端本地音频受浏览器与系统播放规则约束。这些限制不阻断当前桌面浏览器 MVP。

## Windows 一键局域网使用

双击根目录 `Start-FocusSpace.cmd`。首次使用需要 Node.js 22.12+；启动器自动识别 IPv4 地址、更新 `.env` 的监听地址与允许来源、补齐依赖、执行 setup/build 并启动生产服务。首次配置防火墙时允许 Windows 管理员提示；规则仅允许本地子网访问本项目 Node 程序的服务端口，不关闭防火墙。原 `.env` 首次备份到已忽略的 `.env.local`，数据库配置及记录保留。已有 HTTPS 配置会停止并提示沿用原部署。

将启动窗口显示的网址发给同一 Wi-Fi / 局域网的人，各自注册登录，再通过房间码共学。保持主机开机和启动窗口运行。双击 `Stop-FocusSpace.cmd` 停止本启动器创建的服务（Windows 结束进程，重启按应用恢复机制处理）；重新启动会应用新网络地址及代码更新。若端口被开发服务占用，先在其终端 Ctrl+C。重复启动会复用健康的本项目生产服务；网络变化时提示停止后重启。

此入口不提供公网地址；不同网络仍需公网部署或另行配置网络连接。校园网、访客 Wi-Fi 的设备隔离可能阻止互访。

局域网 HTTP 回归验证：先执行 `npm run build`，再执行 `npm run test:lan`。使用独立数据库及两个浏览器会话，明确验证非安全上下文中的创建、加入、实时同步、任务和共学流程，并检查握手来源拒绝规则。证据保存到 `.tmp/lan-http-*`；不写入日常数据库。
