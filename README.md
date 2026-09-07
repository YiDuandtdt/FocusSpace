# FocusSpace

各自学习，一起专注。根据 `Doc/FocusSpace_产品需求文档_PRD_v1.0.docx` 和 `Doc/FocusSpace_开发设计文档_v1.0.md` 实现的多人共学应用。

当前交付：**工程、数据库、注册登录、私人房间和成员实时同步**。浏览器可完成两账号进入同一房间、准备、暂离、修改节奏、刷新恢复和离开。尚未开放专注计时、任务、聊天、Three.js 场景、BGM 和学习结算，页面不会模拟这些功能。

## 启动

需要 Node.js **22.12+（推荐 24 LTS）** 和 npm。无需额外安装数据库服务。以下命令均在项目根目录执行：

```powershell
npm ci
npm run setup
npm run dev
```

打开 **[http://localhost:5173](http://localhost:5173)**。开发模式启动共享类型编译、Express（3001）和 Vite（5173），Vite 将 `/api` 和 `/socket.io` 代理到服务端。首次启动使用同一个主机名访问；`localhost` 与 `127.0.0.1` 的 Cookie 不共享。

`setup` 会复制不存在的 `.env`、生成 Prisma Client、创建 SQLite 文件、应用已有迁移并构建共享包。重复执行保留已有配置和数据。首次依赖下载需要网络；应用运行不需要外部服务、字体或图片。

生产构建、单进程同源运行：

```powershell
npm run build
npm start
```

打开 **[http://localhost:3001](http://localhost:3001)**。同一 Express 进程提供网页、HTTP API 和 Socket.IO，直接刷新 `/rooms/:roomId` 可恢复页面。3001 被占用时，先停止已有开发服务；修改端口后也需同步 `.env` 的 `APP_ORIGINS`，开发代理目标在 `apps/web/vite.config.ts`。

## 体验路径

1. 打开 `/register`，填写账号、昵称、密码和基础形象。注册成功后进入 `/login` 登录。
2. 首页创建房间，选择 25/5、50/10 或自定义分钟数，复制 6 位房间码。
3. 用另一浏览器、独立浏览器配置或无痕窗口注册第二个账号，输入房间码加入。普通标签页共享登录 Cookie，不能用于模拟两个账号。
4. 两端会看到相同座位与成员。切换「我准备好了」「暂时离开」，或点击顶部形象修改昵称和头像，观察另一端同步变化。
5. 房主修改节奏会取消全员准备。刷新页面后恢复原座位和状态；同一账号多个标签页只占一个位置。
6. 普通成员离开后座位释放，可再次输入房间码返回。房主离开会结束全房；最后一个房间连接中断后保留 60 秒，超时普通成员退出、房主结束房间。

没有默认账号、固定房间码或样例数据，正常注册即可体验。房间大厅目前不提供「开始专注」按钮；下一阶段会接入真实服务端计时。

## 已实现

| 能力   | 行为                                                                                         |
| ------ | -------------------------------------------------------------------------------------------- |
| 工程   | npm workspaces；React / TypeScript / Vite；Express；Socket.IO；Prisma 6 / SQLite；依赖锁文件 |
| 数据库 | User、AuthSession、Room、StudySession、RoomMember、CommandReceipt；可重复部署的初始 SQL 迁移 |
| 身份   | 注册、登录、退出、登录恢复、昵称与 4 种基础形象；bcrypt 密码摘要；数据库只存登录令牌摘要     |
| 会话   | HttpOnly / SameSite=Lax Cookie；可撤销及过期；退出使对应旧实时连接失效                       |
| 房间   | 私人房间、随机短码、最多 8 人、服务端座位分配、一人一个活动房间、创建/加入幂等               |
| 实时   | 成员加入/离开、在线/断线、Ready、AFK、昵称/形象、节奏全量快照同步                            |
| 恢复   | 刷新、短时重连、多标签页聚合、服务重启后身份重新确认、房主断线宽限期                         |
| 页面   | 中文注册、登录、首页、房间大厅、房间结束状态、资料编辑、移动端布局、错误和断线提示           |

## 数据与配置

默认数据库位于 **`prisma/data/focusspace.db`**；`.env` 与数据库已被 Git 忽略。SQLite 启用 WAL，数据持久化不依赖浏览器存储。停止应用后备份整个 `prisma/data` 目录；运行期间不要仅复制主文件而遗漏 WAL。

| 环境变量              | 默认值 / 用途                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`        | `file:./data/focusspace.db`，相对 `prisma/schema.prisma`；部署时可使用持久化目录的绝对路径 |
| `HOST` / `PORT`       | `127.0.0.1` / `3001`                                                                       |
| `APP_ORIGINS`         | 允许的浏览器来源，逗号分隔，开发与本地生产端口已配置                                       |
| `COOKIE_SECURE`       | 本地 HTTP 为 `false`；HTTPS 部署设为 `true`                                                |
| `SESSION_DAYS`        | 登录有效期，默认 7 天                                                                      |
| `DISCONNECT_GRACE_MS` | 断线宽限期，默认 60000 毫秒                                                                |

当前按设计采用**单服务进程、本地 SQLite**，进程内串行写队列同时保护房间状态和跨房间成员唯一性，不启动多个副本共享此数据库。HTTPS 反向代理需转发 Socket.IO WebSocket Upgrade，并在 `APP_ORIGINS` 中填写实际网页来源。对外监听时显式配置 `HOST=0.0.0.0`。

新增数据库修改使用 `npm run db:migrate -- --name <名称>`，提交 `prisma/migrations`。查看本地数据使用 `npm run db:studio`。

## 验证

```powershell
npm run typecheck
npm run build
npm run test:flow
```

`test:flow` 自动生成 `.tmp/flow-*` 隔离数据库、选择空闲端口并启动测试服务器，不修改日常数据库。验证注册登录、来源限制、房间事务/幂等、隐私权限、容量、并发跨房间加入、Ready/AFK/节奏/资料广播、多标签页、断线恢复、退出撤销、重启恢复和房主超时结束；随后用两个独立浏览器上下文跑完整页面链路，并保存桌面及移动端截图。超时验证仅在测试服务中使用 3 秒宽限期。

Windows 自动使用已安装的 Microsoft Edge。没有该路径的机器先运行 `npx playwright install chromium`。验证结束自动停止测试服务器；截图和隔离数据保留在 `.tmp`，不会提交到 Git。

## 下一阶段衔接

实现细节与已完成验证见 [阶段交付说明](Doc/阶段交付_工程与房间.md)。下一步围绕现有 `StudySession`、Socket.IO 命令和快照接入：

- 房主 Start、全员准备校验、服务端 Focus/Break 时间轴、轮次推进及重启追赶。
- 私有任务及公开进度、仅休息期聊天，沿用事务内命令凭据与写入成功后广播。
- Three.js 单一房间和 Avatar 状态、BGM；参与区间、阶段区间与 Summary 结算。

当前的结束操作仅结束尚未开始的 Lobby，不生成学习记录。接入计时后应将结束与断线处理统一迁入 SessionService，并在同一事务内关闭区间、保存 StudyRecord。

技术兼容性参考：[Vite 运行要求](https://vite.dev/guide/)、[Prisma 6 迁移流程](https://www.prisma.io/docs/orm/v6/prisma-migrate/getting-started)、[Socket.IO 消息交付保证](https://socket.io/docs/v4/delivery-guarantees/)。
