# FocusSpace 开发设计文档

版本：v1.0 ｜ 日期：2026-09-07 ｜ 定位：MVP 实现基线

依据：《FocusSpace_产品需求文档_PRD_v1.0.docx》。本文将产品需求转为可直接开发的架构、业务规则、数据模型和接口契约。开发按能力闭环推进，不按天拆分；只保留保护主流程与数据正确性的必要验证。

## 1. 实现目标与范围

本期交付浏览器端多人共学应用：注册登录 → 创建或加入私人房间 → 设置任务与准备 → 共享 Focus/Break 节奏 → 同步任务与休息聊天 → 结束并查看学习记录。3D 房间和 BGM 服务于共学状态展示，不承担业务逻辑。

### 1.1 范围划分

| 范围 | 本期实现 |
| --- | --- |
| 必须交付 | 注册、登录、昵称与基础 Avatar；房间码加入；成员与准备状态；25/5、50/10、自定义节奏；服务端计时；任务创建与完成同步；Break 聊天；单一 3D 房间；至少一种 BGM；结算持久化；刷新与短时断线恢复 |
| 最小补充 | AFK 开关及视觉状态，用于闭合 PRD 的 A-03 验收；仅传递任务数量与进度，默认不公开标题；房主断线超时结束房间 |
| 后续增强 | 公开房间、房主转移、更多主题和动画、任务标题公开设置、房间总体进度、个人历史页面、聊天历史查询、表情互动 |
| 延后 | 自由移动与碰撞、视频语音、好友私聊、商城、排行榜、复杂反作弊、AI 扩展 |

注册登录按明确的 P0 需求实现；PRD 流程中提到的访客入口不进入本期。Admin 保留角色及敏感操作日志，本期不建设完整管理后台。基础 Summary 展示共同学习人数，房间共同专注时长与长期统计后续补充。

### 1.2 本文补充的默认规则

以下是为消除实现歧义而提出的设计决策，并非 PRD 已明确规定的要求：每房最多 8 人；一个用户同时参与一个未结束房间；一个房间对应一次可包含多轮的 Session；创建房间时即建立 LOBBY Session；休息结束自动进入下一轮；结束后的房间不可再次加入，继续共学需新建房间。

首期采用单个服务端进程和本地持久化数据库。上述限制均集中配置，不为多实例、高并发或复杂运营提前搭建基础设施。

## 2. 技术架构与工程组织

### 2.1 推荐技术组合

当前工作区只有 PRD，没有既有代码约束。建议采用以下组合，具体兼容版本在建项时锁定到依赖锁文件，不以“最新版”为运行约束。

| 层次 | 选择 | 作用 |
| --- | --- | --- |
| Web 界面 | React + TypeScript + Vite | 页面、表单、计时展示和房间状态视图 |
| 3D | Three.js | 固定视角房间、座位及轻量 Avatar 状态 |
| 服务端 | Node.js + TypeScript + Express | HTTP 接口、鉴权、业务服务与定时调度 |
| 实时通道 | Socket.IO | 房间订阅、命令确认、状态广播和重连 |
| 数据存储 | Prisma + SQLite | 用户、房间、任务、阶段与学习记录 |
| 部署 | 一个应用服务 + 持久化目录 | 同源提供静态页面、HTTP 与实时连接 |

SQLite 适合本设计的单实例课程项目规模；Prisma 提供 SQLite 连接器。后续确需多实例时，再评估 PostgreSQL、跨进程广播和唯一调度者，而非直接复制当前进程。[Prisma SQLite 文档](https://www.prisma.io/docs/orm/v6/overview/databases/sqlite)

### 2.2 数据流与职责

浏览器 UI / 3D → HTTP 与 Socket.IO 入口 → 应用服务 → SQLite；应用服务在写入成功后，通过 Socket.IO 将结果同步给房间成员。

RoomService 管理加入、离开和权限；SessionService 统一开始、切换和结束阶段；TaskService 管理个人任务；ChatService 执行休息期聊天规则；RecordService 负责结算。HTTP 与 Socket.IO 调用同一组服务，避免各写一套业务规则。

SQLite 是持久化事实来源。内存只保存连接集合、房间命令队列和计时器句柄；倒计时不逐秒写库，也不逐秒广播。所有房间命令及定时事件按 roomId 串行执行，事务内再检查阶段和版本，阻止同时 Start、重复结算及聊天跨越阶段边界。

### 2.3 建议目录

| 路径 | 内容 |
| --- | --- |
| apps/web/src/pages | 登录、首页、房间、Summary |
| apps/web/src/features | 任务、聊天、成员、音频、计时组件 |
| apps/web/src/scene | Three.js 场景、Avatar 与资源释放 |
| apps/web/src/state | 房间快照、订阅及状态派生 |
| apps/server/src/modules | auth、room、session、task、chat、record |
| apps/server/src/realtime | Socket.IO 鉴权、订阅与消息适配 |
| apps/server/src/jobs | 阶段调度、心跳检查和重启恢复 |
| packages/shared | DTO、枚举、校验规则和错误码 |
| prisma / assets / Doc | 数据模型与迁移 / 资源与授权说明 / 产品及开发文档 |

## 3. 核心业务与状态设计

### 3.1 房间与 Session 生命周期

StudySession.phase 是阶段唯一来源；Room 通过 sessionId 获取状态，不再保存一份可以独立修改的 phase。roundNo 从 1 开始，LOBBY 时为 0。

| 当前阶段 | 触发 | 下一阶段 | 服务端处理 |
| --- | --- | --- | --- |
| LOBBY | 房主 Start | FOCUS | 确认在线成员已准备；写入开始时间和第 1 轮 |
| FOCUS | phaseEndAt 到期 | BREAK | 关闭本段专注，写入休息起止时间 |
| BREAK | phaseEndAt 到期 | FOCUS | 轮次加一，建立新的专注时间段 |
| LOBBY / FOCUS / BREAK | 房主结束或系统关闭 | ENDED | 关闭当前区间、结算一次、禁止继续写入 |
| ENDED | 重复结束 | ENDED | 返回已有结算结果 |

房主也须 Ready；至少有房主一人在线且当前保留的成员均在线、已准备，才能 Start。没有任务不阻止开始。新增成员后按最新成员集合重新判断。修改节奏会清除所有 Ready，防止成员在不知情下开始不同配置。

节奏在 LOBBY 可修改，开始后固定。正式模式建议允许 Focus 1–180 分钟、Break 1–60 分钟；内部统一存秒。演示模式由服务端环境开关启用 45 秒 / 15 秒，页面清楚标注。

### 3.2 成员、迟到与离开

成员展示状态按优先级派生：LEFT → DISCONNECTED → AFK → 当前阶段状态；LOBBY 再区分 JOINED / READY。服务端只保存连接、离席和准备事实，避免 phase 与 memberStatus 相互矛盾。

中途加入时直接恢复房间当前阶段和剩余时间，标记“中途加入”，从加入时刻开始计时，不补记已过去的时间。任务可在加入后立即设置，不等待下一轮；该规则为本期默认取舍，公开房间的“预约下一轮”后续再做。

连接以 userId 聚合。同一账号多个标签页只占一个座位，关闭其中一个不会触发离开；最后一个连接断开后显示 DISCONNECTED，保留座位和成员资格 60 秒。到期转为 LEFT；同房重返复用成员记录和既有任务，重新分配可用座位，不产生重复成员。

主动离开立即关闭个人计时区间。房主主动离开视为结束全房 Session；房主最后一个连接断开后允许 60 秒恢复，超时由系统结束并结算，不在本期自动转移房主。其他成员短时断线不改变房间节奏。每个连接发送轻量心跳，服务端只在整个用户的连接集合失活时改变成员在线状态。

### 3.3 时间同步与阶段恢复

加入、重连和切回前台时请求 serverTime、phaseStartAt、phaseEndAt 和 revision。客户端记录请求发送 t0、接收 t1，近似计算 offset = serverTime − (t0 + t1) / 2；显示剩余秒数为 ceil(max(0, phaseEndAt − correctedNow) / 1000)。客户端用单调时钟推进已校准时间，避免用户修改系统时间导致跳变。

本地计时到零只触发一次快照确认，不自行进入 Break 或开放聊天。服务端调度器按 phaseEndAt 唤醒，并以旧 phaseEndAt 为下一阶段起点；调度稍晚时补齐已经跨过的阶段，防止每轮漂移。处理聊天、任务和结束命令前也先推进已到期的阶段。

进程重启后，从数据库恢复未结束 Session，按已保存的时间轴计算当前阶段。在线资格全部重新确认，成员离线期间不补记个人专注时长；房主在恢复宽限期内未回来则系统结束。阶段恢复和成员失效处理先完成，再对外提供可操作快照。

### 3.4 任务、聊天与个人隐私

任务属于 sessionId + userId。创建、编辑、删除允许在 LOBBY、FOCUS、BREAK 执行，结束后只读；Ready 不冻结任务。完成操作提交明确的 completed=true/false，而非 toggle，支持失败重试。任务数量为零时进度显示“未设置任务”，不显示 100%。

个人接口返回自己的完整任务；公共快照和广播仅包含 tasksDone、tasksTotal、progressPercent。P0 固定隐藏他人的任务标题，从服务端序列化时剔除；后续再做公开设置。管理员角色不自动获得任务标题读取权限。

普通聊天仅在 BREAK 接受，服务端以实际接收并处理时的阶段判断。限制每条 500 字、每用户每 2 秒一条；按纯文本显示。聊天在接收成功后保存，当前连接可见新消息；历史查询为 P1，不承诺刷新后补齐全部聊天。Focus 到来时输入区禁用并收起，休息结束前 10 秒只做轻提示。

## 4. 数据模型与统计口径

所有主键使用服务端生成的 ID；时间在库中使用 UTC，接口统一为 Unix 毫秒。以下列出业务关键字段，常规 createdAt / updatedAt 按需统一添加。

| 实体 | 关键字段与约束 |
| --- | --- |
| User | id、username（唯一）、passwordHash、nickname、avatarId、role |
| AuthSession | id、tokenHash（唯一）、userId、expiresAt、revokedAt |
| Room | id、code（唯一）、name、ownerId、sessionId（唯一）、capacity、revision |
| RoomMember | roomId、userId、seatIndex、ready、afk、connectionState、joinedAt、leftAt、lastSeenAt；唯一(roomId,userId) |
| StudySession | id、phase、roundNo、focusSeconds、breakSeconds、phaseStartAt、phaseEndAt、startedAt、endedAt、endReason |
| PhaseInterval | id、sessionId、roundNo、phase、startAt、endAt；唯一(sessionId,roundNo,phase) |
| PresenceInterval | id、sessionId、userId、startAt、endAt、endReason；记录在线且非 AFK 的参与区间 |
| Task | id、sessionId、userId、title、completed、completedAt、version |
| ChatMessage | id、roomId、sessionId、userId、content、createdAt、requestId；唯一(userId,requestId) |
| StudyRecord | id、sessionId、userId、focusSeconds、roundsCompleted、tasksDone、tasksTotal、studiedWith；唯一(sessionId,userId) |
| CommandReceipt | userId、requestId、commandType、payloadHash、result、createdAt；唯一(userId,requestId) |
| AuditLog | actorId、action、targetId、result、createdAt；仅记录管理员敏感操作 |

Theme 与基础 Avatar 先用代码配置及本地静态资源，不为单一主题额外建管理系统。任务、消息、区间分别建立 sessionId + userId 或 sessionId + createdAt 查询索引。活动座位在房间串行加入事务中检查唯一；离开成员释放座位但保留历史成员关系。

### 4.1 写入与一致性

创建房间时在一次事务内写 Room、LOBBY StudySession 和房主成员记录，使入场任务始终有 sessionId。加入前可在页面填写任务草稿，成功加入后批量创建；跨房间不能沿用旧 sessionId。房间码采用不易混淆的随机大写字符，数据库唯一约束冲突后重新生成。

开始、阶段切换、任务修改和结束均先事务提交，再广播并确认。结束事务同时关闭区间、保存个人 StudyRecord 和 ENDED 状态。CommandReceipt 与对应业务修改同事务保存；相同 requestId 和内容返回原结果，内容不同则拒绝。普通任务更新再以 version 检查并发修改，冲突后读取最新任务。

### 4.2 统计定义

Focus Time：个人在线且非 AFK 区间与 FOCUS 区间交集的秒数之和，合并重叠区间，避免多标签重复计算。正常断线以服务器检测到断线时截止；仅通过心跳发现失联时，以最后一次有效心跳截止。每 15 秒保存一次活跃成员的 lastSeenAt，异常进程退出最多损失一个心跳间隔的记录，不把服务停机时间当学习时间。

Rounds：个人从开始到结束完整参与的 Focus 轮数；迟到、提前离开、AFK 或断线中断的轮次不计完整轮，但保留已参与秒数。房间已完成轮数可单独由完整 PhaseInterval 计算，不与个人轮数混用。

Tasks / Completion：Session 结束时未删除任务的完成数、总数及比例；结束后冻结。Studied With：与本人存在正时长 Focus 交集的其他用户去重数，不含自己，也不计仅在 Lobby 同时出现的人。

本期不以在线时间证明用户真实注意力，也不通过切屏监控扣减。若后续增加 Room Time，定义为至少两名有效成员同时处于 Focus 的时间并集，不使用所有成员时长简单相加。

## 5. 接口与实时协议

### 5.1 HTTP 接口

统一前缀 /api。身份来自登录会话；userId、role、ownerId 不信任客户端声明。读取操作负责查询或恢复；房间实时写操作统一经 Socket.IO 命令入口，避免两种入口行为分叉。

| 方法与路径 | 输入或用途 | 关键返回 |
| --- | --- | --- |
| POST /auth/register | username、password、nickname | 用户资料 |
| POST /auth/login | username、password | 设置会话 Cookie、用户资料 |
| POST /auth/logout | 撤销当前登录会话 | 清除 Cookie、关闭该会话连接 |
| GET /auth/me | 恢复登录状态 | 用户资料、当前房间 |
| PATCH /users/me | nickname、avatarId | 更新后的用户资料 |
| POST /rooms | name、focusSeconds、breakSeconds、requestId | roomId、code、sessionId |
| POST /rooms/join | code、requestId | 成员资格、roomId、sessionId |
| GET /rooms/:id/snapshot | 已授权成员恢复状态 | 按访问者过滤的完整快照 |
| GET /sessions/:id/summary | 本人曾参与的已结束 Session | 本人 StudyRecord、房间轮次 |
| GET /health | 运行与数据库可用性 | 简单就绪状态 |

注册后进入登录流程；不实现邮件校验和密码找回扩展。登录凭据使用随机不透明令牌，数据库仅保存摘要，Cookie 设置 HttpOnly、SameSite=Lax，HTTPS 部署启用 Secure。HTTP 写请求和 Socket.IO 握手校验 Origin；写操作再次验证会话未撤销。密码用成熟密码哈希库处理，禁止明文保存。

### 5.2 Socket.IO 命令与事件

客户端先通过 HTTP 获取成员资格，再发送 room:join 订阅；订阅本身不授予成员权限。所有命令使用 {requestId, roomId, payload}，确认统一为 {requestId, ok, revision, data, error}。事件使用 {eventId, roomId, sessionId, revision, serverTime, type, data}，revision 为持久化房间状态版本。

| 客户端命令 | 权限与输入 | 结果事件 |
| --- | --- | --- |
| room:join / room:sync | 当前成员；订阅或恢复 | room:snapshot |
| room:configure | 房主、LOBBY；节奏参数 | room:updated |
| member:ready | 本人、LOBBY；ready 布尔值 | member:updated |
| member:afk | 本人；afk 布尔值 | member:updated |
| session:start | 房主；无客户端时间戳 | session:started |
| task:create / task:delete | 本人；标题或 taskId | task:updated |
| task:update | 本人；taskId、version、明确字段值 | task:updated |
| chat:send | 当前成员、BREAK；content | chat:message |
| member:leave | 本人；离开当前房间 | member:left / session:ended |
| session:end | 房主；正常结束原因 | session:ended |
| 服务端调度 | 到期切换阶段 | phase:change |

广播内容始终按公共字段输出；task:updated 的公共部分只有用户进度，完整任务通过该用户的确认或用户专属事件回传。头像变化及连接变化也发布 member:updated。客户端以事件统一包中的 type 区分状态变化，不依赖 DOM 当前页面判断业务是否合法。

### 5.3 快照、重试与错误

room:snapshot 包含 room、session、members（含座位与公开进度）、myTasks、myPermissions、revision、serverTime；不返回密码摘要、会话令牌或他人私有任务。ENDED 快照附带 Summary 地址，原参与者可读取，外部用户不能用房间码旁观记录。

每次已提交的房间状态变更递增 revision。为控制 MVP 的客户端合并复杂度，每次变更向授权订阅者发送按用户过滤的最新快照；语义事件用于短暂提示与聊天展示，不再单独修改一套业务状态。同一版本的提示事件允许多个，以 eventId 去重，不能仅因 revision 相等就丢弃聊天。快照只接受较新版本，首次加入可接受当前版本。

订阅与快照建立在同一房间队列内完成，防止取完快照后才加入广播组而漏事件。断线后禁用写操作，重连重新鉴权并获取快照；每 30 秒进行轻量版本对齐，发现版本落后再拉全量。确认超时先同步状态，必要时使用相同 requestId 重试一次，聊天草稿不会断线后自动补发。

Socket.IO 默认不保证断线消息补达，恢复功能也可能失败，因此上述数据库幂等与快照恢复属于应用自身职责。本期不建设事件回放系统。[消息交付保证](https://socket.io/docs/v4/delivery-guarantees/)；[连接状态恢复](https://socket.io/docs/v4/connection-state-recovery/)

通用错误码：UNAUTHORIZED、FORBIDDEN、ROOM_NOT_FOUND、ROOM_FULL、ROOM_ENDED、ALREADY_IN_ROOM、NOT_READY、INVALID_PHASE、CONFLICT、RATE_LIMITED。接口返回用户能理解的原因；非成员访问私人房间统一按不存在处理。数据库写失败不广播成功、不保留乐观结果，客户端提示重试。

## 6. 页面与沉浸体验实现

### 6.1 页面组织

| 页面 | 核心内容 | 状态与交互 |
| --- | --- | --- |
| /login、/register | 账号表单 | 成功后进入首页或返回原房间 |
| / | 创建房间、输入房间码 | 暂不展示无真实数据支撑的在线统计 |
| /rooms/:roomId | Lobby 与 Focus/Break 共用容器 | phase 驱动内容切换，避免页面跳转丢连接 |
| /sessions/:sessionId/summary | 时长、轮次、任务、共同学习人数 | 读取已保存记录；可创建新房间 |

房间容器承载 PhaseTimer、TaskPanel、MemberList、ChatPanel、SceneCanvas、AudioControls。只保留一个 Socket 连接管理器；房间切换时解除旧订阅和监听。服务端快照状态与本地音量、面板开关、输入草稿分开保存。

Lobby 展示房间码、成员、任务和 Ready / Start。Focus 优先展示倒计时、3D 空间、个人任务；聊天收起。Break 在同一布局展开聊天和本轮小结。断线状态以小横幅提示，任务和聊天保留可见内容但禁止提交；恢复后以服务器快照覆盖旧状态。

### 6.2 3D 与 Avatar

采用固定相机、单一房间、8 个预设座位和几何体 Avatar。颜色或少量基础形象承载选择；seatIndex 由服务端分配，重连保留，避免每个客户端排序造成位置不同。

JOINED / READY 使用待机与准备标记，FOCUSING 使用伏案或轻微书写动作，BREAKING 使用靠后或伸展，AFK 显示空座与离席提示，DISCONNECTED 降低透明度，LEFT 移除。昵称与明确的文字状态同屏呈现，不只依靠颜色区分。

Three.js 只消费成员和阶段数据，不自行发起 Start、结束或计时。房间状态变化时更新对象属性，动画循环只处理轻运动；避免每帧触发整个 React 组件树更新。限制像素比至 1.5，先关闭高成本阴影，按需加载场景代码；离开页面释放几何体、材质、纹理和监听。相关渲染能力以官方 WebGLRenderer 接口为准。[Three.js 文档](https://threejs.org/docs/pages/WebGLRenderer.html)

正常设备必须呈现基础 3D 房间；资源加载失败或 WebGL 不可用时降级为座位卡片，计时和任务仍可使用。降级是异常保障，不替代 P0 的 3D 交付。首期用几何体完成视觉状态，外部模型和高级动画不阻塞闭环。

### 6.3 音频与资源

BGM 完全本地控制，用户主动点击后播放，默认关闭；不广播播放进度或强制全房同步。首期提供一种可循环环境声及播放/暂停，加载失败只提示音频不可用。音量控制与多主题作为后续增强。

场景和音频随应用静态资源部署，避免答辩时依赖第三方资源链接。assets 保存资源来源、授权和压缩版本；优先自制几何体及已获许可音频。UI 核心信息不依赖音频通知传达。

## 7. 持久化、部署与必要保护

提供 .env.example、数据库迁移、基础资源和启动说明。配置集中管理 PORT、DATABASE_URL、APP_ORIGIN、DEMO_MODE、ROOM_CAPACITY、DISCONNECT_GRACE_SECONDS。演示账号由显式初始化命令生成，不把默认管理员口令写入仓库。

开发环境由 Vite 代理 /api 与 /socket.io；部署时同源提供页面和接口，若有反向代理则转发 WebSocket 升级并设置合适的连接超时。SQLite 文件放在可写的持久化目录，应用更新时保留数据库；单实例运行，不启用多 worker。

鉴权、房主权限、任务归属、阶段限制均由服务端执行。房间码只是加入入口，不能替代登录或成员校验；加入尝试与登录做基本限流。日志记录 requestId、roomId、操作和错误原因，不打印密码、令牌及私有任务正文。管理员封禁或强制结束必须写 AuditLog，管理员面板留到后续。

PhaseInterval、成员参与区间及统计随 Session 保留；聊天内容默认保留 24 小时后批量清理。已结束 Session 的 CommandReceipt 建议保留 7 天，过期重试由 ENDED 状态拒绝，不得重新创建业务结果。创建房间与加入请求的幂等凭据同样设置有限保留期。

性能目标按 PRD 正常网络下约 1 秒级成员、进度和聊天同步落地；容量先按单房 8 人设计，不承诺未经验证的系统总并发。先通过限制资源与广播频率控制成本，仅在实际出现卡顿或延迟时定位优化。

## 8. 开发推进方式

每个阶段产出可运行能力，完成后继续下一阶段，不安排固定天数、独立等待期或大规模审查。必要修复随实现完成，不以覆盖率、重复演示次数作为机械停止条件。

| 阶段 | 重点实现 | 可继续推进的结果 |
| --- | --- | --- |
| 工程与身份入口 | 前后端工程、共享类型、数据库迁移、登录、创建和加入房间 | 两个独立账号进入同一房间 |
| 共享学习主流程 | 成员订阅、Ready、服务端状态机、时间戳、Focus/Break 切换 | 多端经历同一轮次与阶段 |
| 任务与交流 | 任务保存和进度广播、私有字段过滤、Break 聊天 | 专注推进任务，休息正常交流 |
| 空间与复盘 | 单一 3D 房间、Avatar 状态、BGM、参与区间和 Summary | 共学体验与结束记录闭合 |
| 恢复与交付 | 快照重连、房主异常结束、启动恢复、部署配置与必要修复 | 可启动、可恢复、可演示的完整版本 |

幂等、权限和事务在对应模块首次实现时一起完成；最后一阶段做连接恢复与部署联调，不把基础一致性留到最后补救。先做基础几何体与正常业务链路，再补视觉细节；P0 完成后才选 P1。

### 8.1 保留的最小验证

使用两个或三个独立账号完成一条短演示链路：建房与加入 → Ready / Start → 任务进度同步 → Focus 禁聊 → Break 发言 → 自动进入下一轮 → 结束 Summary。不同浏览器或独立配置文件隔离登录；同一浏览器多个普通窗口通常共享 Cookie。

在这条链路中插入一次刷新或断线恢复，顺带确认时间不重置；再确认一次越权任务更新被拒绝，以及重复结束不重复生成记录。阶段切换与统计计算可用可注入时钟检查，不等待真实 25/5 时长，不为简单 UI 或配置项逐项编写测试。

运行类型检查和生产构建，处理阻断错误即可。仅当发现问题或修改相关逻辑时重跑对应验证，不增加与当前实现无关的长时间压测、全仓审查或多轮重复演示。

### 8.2 开发交付物

完整前后端代码、共享接口定义、数据库迁移、基础 3D 与音频资源、.env.example、启动及部署说明，以及一份简短的演示入口说明。以“多人同步共学流程可运行且记录可恢复”为完成依据，公开房间、复杂统计和运营后台不阻塞本期交付。

## 9. 需求对应与参考

PRD 第 5、6 节对应本文功能边界与页面设计；第 7 节对应服务端状态机、实时协议和恢复；第 8 节对应身份、权限及数据模型；第 9、11 节对应本期范围与最小验证。原第 10 节按 Day 的排期已替换为能力阶段；第 12 节用户访谈与第 14 节多次答辩演示不作为开发前置门槛。

对 PRD 的主要补充为：迟到直接同步当前阶段、房主断线超时结束、AFK 最小实现、任务标题默认私有、个人有效时长与轮次口径、单房单 Session 和单实例部署。后续产品决定调整时，集中修改相关规则与契约，不扩散为零散页面判断。

产品依据：同目录《FocusSpace_产品需求文档_PRD_v1.0.docx》，版本 v1.0，2026-09-07。技术文档链接已在相应设计处标注，仅用于确认组件能力；容量、超时、统计及实现阶段均为本文设计选择。
