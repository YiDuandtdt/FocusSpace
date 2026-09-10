import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type {
  ChatMessage,
  RoomCommand,
  RoomSnapshot,
  SessionSummary,
  Task,
  Todo,
} from '@focusspace/shared';
import { useAuth } from '../auth';
import { useDraft } from '../preferences';
import { Modal, Notice } from '../components';
import { api, errorMessage } from '../api';
import { RewardFeedback } from './GrowthFeedback';

export function PhaseTimer({
  session,
  serverNow,
  syncNow,
}: {
  session: RoomSnapshot['session'];
  serverNow: () => number;
  syncNow: () => void;
}) {
  const [remaining, setRemaining] = useState(() =>
    Math.ceil(Math.max(0, (session.phaseEndAt ?? 0) - serverNow()) / 1000),
  );
  useEffect(() => {
    let confirmed = false;
    const tick = () => {
      const value = Math.ceil(Math.max(0, (session.phaseEndAt ?? 0) - serverNow()) / 1000);
      setRemaining(value);
      if (session.phaseEndAt && value === 0 && !confirmed) {
        confirmed = true;
        syncNow();
      }
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [session.phaseEndAt, serverNow, syncNow]);
  return (
    <section className={`phase-timer timer-${session.phase}`} aria-label="共享倒计时">
      <span className="eyebrow">
        {session.phase === 'FOCUS' ? 'FOCUS · 正在专注' : 'BREAK · 休息一下'} · 第 {session.roundNo}{' '}
        轮
      </span>
      <strong role="timer" aria-label="剩余时间">
        {String(Math.floor(remaining / 60)).padStart(2, '0')}:
        {String(remaining % 60).padStart(2, '0')}
      </strong>
      <p role="status">
        {remaining === 0
          ? '正在确认下一阶段…'
          : session.phase === 'BREAK' && remaining <= 10
            ? '休息即将结束，准备回到自己的目标。'
            : session.phase === 'FOCUS'
              ? '各自推进，一起认真。'
              : '伸个懒腰，也和搭子聊两句。奖励在本场结束后统一到账，提前离开的有效学习也会保留。'}
      </p>
      {session.demoMode ? (
        <small className="demo-label">演示节奏 · 45 秒专注 / 15 秒休息</small>
      ) : null}
    </section>
  );
}

type Command = (type: RoomCommand, payload?: unknown) => Promise<void>;
const flattenTodos = (items: Todo[], depth = 0): { item: Todo; depth: number }[] =>
  items.flatMap((item) => [{ item, depth }, ...flattenTodos(item.children, depth + 1)]);
const orderTasks = (
  tasks: Task[],
  parentId: string | null = null,
  depth = 0,
): { task: Task; depth: number }[] => {
  const children = tasks.filter((task) => task.parentId === parentId);
  return children.flatMap((task) => [{ task, depth }, ...orderTasks(tasks, task.id, depth + 1)]);
};
export function TaskPanel({
  tasks,
  roomId,
  disabled,
  ended,
  command,
}: {
  tasks: Task[];
  roomId: string;
  disabled: boolean;
  ended: boolean;
  command: Command;
}) {
  const { user } = useAuth();
  const draftKey = user!.id + ':' + roomId + ':task';
  const [title, setTitle] = useDraft(draftKey, '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [parentTaskId, setParentTaskId] = useState('');
  const [priority, setPriority] = useState<Task['priority']>('MEDIUM');
  const [dueAt, setDueAt] = useState('');
  const [labels, setLabels] = useState('');
  const [showTaskDetails, setShowTaskDetails] = useState(false);
  const done = tasks.filter((t) => t.completed).length;
  async function run(type: RoomCommand, payload: unknown) {
    if (busy || disabled || ended) return false;
    setBusy(true);
    setError('');
    try {
      await command(type, payload);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (
      await run('task:create', {
        title,
        parentTaskId: parentTaskId || null,
        priority,
        dueAt: dueAt ? new Date(`${dueAt}T23:59:00`).toISOString() : null,
        labels: labels
          .split(/[,，]/)
          .map((label) => label.trim())
          .filter(Boolean),
      })
    ) {
      setTitle('');
      setParentTaskId('');
      setDueAt('');
      setLabels('');
      setShowTaskDetails(false);
    }
  }
  async function openPicker() {
    setError('');
    try {
      const data = await api<{ items: Todo[] }>('/users/me/todos');
      setTodos(data.items);
      setSelected(new Set());
      setShowPicker(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function addSelected() {
    if (!selected.size || busy) return;
    setBusy(true);
    setError('');
    try {
      for (const todoId of selected) {
        await api(`/users/me/todos/${todoId}/room`, {
          method: 'POST',
          body: { roomId, requestId: crypto.randomUUID() },
        });
      }
      setShowPicker(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel task-panel">
      <div className="panel-heading">
        <h2>我的任务</h2>
        <div className="panel-heading-tools">
          <span>{tasks.length ? `${done} / ${tasks.length}` : '未设置任务'}</span>
          <button
            type="button"
            className="icon-help"
            aria-label="查看任务完成统计规则"
            onClick={() => setShowRules(true)}
          >
            ?
          </button>
          {!ended ? (
            <button
              type="button"
              className="text-button"
              disabled={disabled || busy}
              onClick={() => void openPicker()}
            >
              从清单加入
            </button>
          ) : null}
        </div>
      </div>
      {showRules ? (
        <Modal className="info-dialog" onCancel={() => setShowRules(false)}>
          <h2>任务完成统计</h2>
          <p>
            整场按未删除任务的当前状态计数：取消完成扣除完成数，删除同时移除总数和完成数。本轮只计首次完成发生在本轮、且当前仍完成的任务；重复勾选不新增次数，跨轮重复完成不算新成果。休息期间完成归当前轮，大厅完成不归专注轮。结算后冻结。
          </p>
          <button className="button primary" onClick={() => setShowRules(false)}>
            知道了
          </button>
        </Modal>
      ) : null}
      <progress aria-label="我的任务完成进度" max={tasks.length || 1} value={done} />
      <ul className="task-list">
        {orderTasks(tasks).map(({ task, depth }) => (
          <TaskRow
            key={task.id}
            draftKey={draftKey + ':' + task.id}
            task={task}
            disabled={disabled || busy || ended}
            run={run}
            depth={depth}
          />
        ))}
      </ul>
      {!tasks.length ? <p className="muted">写下一个小目标</p> : null}
      {!ended ? (
        <form className="task-create" onSubmit={create}>
          <input
            aria-label="新任务"
            placeholder="这次想完成什么？"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
            disabled={disabled || busy}
          />
          <button className="button secondary" disabled={disabled || busy || !title.trim()}>
            添加任务
          </button>
          <button
            type="button"
            className="text-button task-details-toggle"
            aria-expanded={showTaskDetails}
            onClick={() => setShowTaskDetails(!showTaskDetails)}
          >
            设置
          </button>
          {showTaskDetails ? (
            <div className="task-create-details">
              <label>
                上级任务
                <select
                  value={parentTaskId}
                  onChange={(event) => setParentTaskId(event.target.value)}
                >
                  <option value="">无（主任务）</option>
                  {orderTasks(tasks)
                    .filter(({ depth }) => depth < 5)
                    .map(({ task, depth }) => (
                      <option key={task.id} value={task.id}>
                        {'　'.repeat(depth)}
                        {task.title}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                优先级
                <select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as Task['priority'])}
                >
                  <option value="HIGH">高</option>
                  <option value="MEDIUM">中</option>
                  <option value="LOW">低</option>
                </select>
              </label>
              <label>
                截止日期
                <input
                  type="date"
                  value={dueAt}
                  onChange={(event) => setDueAt(event.target.value)}
                />
              </label>
              <label>
                标签
                <input
                  value={labels}
                  onChange={(event) => setLabels(event.target.value)}
                  placeholder="课程，复习"
                />
              </label>
            </div>
          ) : null}
        </form>
      ) : null}
      {error ? <Notice>{error}</Notice> : null}
      {showPicker ? (
        <Modal
          className="todo-picker-dialog"
          onCancel={() => setShowPicker(false)}
          aria-labelledby="todo-picker-title"
        >
          <div className="panel-heading">
            <div>
              <span className="eyebrow">TODO LIST</span>
              <h2 id="todo-picker-title">选择待办加入房间</h2>
            </div>
            <button className="text-button" onClick={() => setShowPicker(false)}>
              ✕
            </button>
          </div>
          <p className="muted">加入后，两处的完成状态会保持同步。子任务可独立选择。</p>
          <ul className="todo-picker-list">
            {flattenTodos(todos)
              .filter(({ item }) => !item.completed)
              .map(({ item, depth }) => {
                const linked = item.linkedRoomId === roomId;
                return (
                  <li key={item.id} style={{ paddingLeft: 10 + Math.min(depth, 5) * 20 }}>
                    <label>
                      <input
                        type="checkbox"
                        checked={linked || selected.has(item.id)}
                        disabled={linked}
                        onChange={(event) =>
                          setSelected((old) => {
                            const next = new Set(old);
                            if (event.target.checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          })
                        }
                      />
                      <span>{item.title}</span>
                      {linked ? <small>已加入</small> : null}
                    </label>
                  </li>
                );
              })}
          </ul>
          {!flattenTodos(todos).some(({ item }) => !item.completed) ? (
            <p className="muted">没有可加入的待办。</p>
          ) : null}
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setShowPicker(false)}>
              取消
            </button>
            <button
              className="button primary"
              disabled={!selected.size || busy}
              onClick={() => void addSelected()}
            >
              加入 {selected.size || ''} 项
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
function TaskRow({
  task,
  draftKey,
  disabled,
  run,
  depth,
}: {
  task: Task;
  draftKey: string;
  disabled: boolean;
  run: (type: RoomCommand, payload: unknown) => Promise<boolean>;
  depth: number;
}) {
  const [saved, setSaved] = useDraft(draftKey, {
    editing: false,
    title: task.title,
    version: task.version,
  });
  const editing = saved.editing,
    draft = saved.title,
    version = saved.version;
  const [deleting, setDeleting] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (await run('task:update', { taskId: task.id, version, title: draft }))
      setSaved({ ...saved, editing: false });
  }
  const changed = editing && version !== task.version;
  return (
    <li
      className={`task-row ${editing ? 'task-row-editing' : ''}`}
      style={{ paddingLeft: Math.min(depth, 5) * 18 }}
    >
      <input
        type="checkbox"
        aria-label={`完成任务：${task.title}`}
        checked={task.completed}
        disabled={disabled}
        onChange={(e) =>
          void run('task:update', {
            taskId: task.id,
            version: task.version,
            completed: e.target.checked,
          })
        }
      />
      {editing ? (
        <form className="task-edit" onSubmit={save}>
          <input
            aria-label="编辑任务标题"
            value={draft}
            maxLength={200}
            required
            disabled={disabled}
            onChange={(e) => setSaved({ ...saved, title: e.target.value })}
          />
          {changed ? (
            <p className="muted">此任务已在其他标签页修改。请取消编辑后重新打开，避免覆盖。</p>
          ) : null}
          <button className="text-button" disabled={disabled || changed}>
            保存
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => setSaved({ ...saved, editing: false })}
          >
            取消
          </button>
        </form>
      ) : (
        <>
          <button
            className="text-button task-visibility"
            disabled={disabled}
            aria-label={
              task.visibility === 'PUBLIC' ? '设为私有：' + task.title : '公开任务：' + task.title
            }
            onClick={() =>
              void run('task:update', {
                taskId: task.id,
                version: task.version,
                visibility: task.visibility === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC',
              })
            }
          >
            {task.visibility === 'PUBLIC' ? '已公开' : '私有'}
          </button>
          <span className={`task-title ${task.completed ? 'task-done' : ''}`}>
            {task.title}
            <small className="room-task-meta">
              {task.todoId ? '清单同步 · ' : ''}
              {task.priority === 'HIGH' ? '高优先级' : task.priority === 'LOW' ? '低优先级' : ''}
              {task.dueAt
                ? `${task.priority === 'MEDIUM' ? '' : ' · '}截止 ${new Date(task.dueAt).toLocaleDateString()}`
                : ''}
              {task.labels.map((label) => ` #${label}`).join('')}
            </small>
          </span>
          <div className="task-actions">
            <button
              className="text-button"
              aria-label={`编辑任务：${task.title}`}
              disabled={disabled}
              onClick={() => {
                setSaved({ title: task.title, version: task.version, editing: true });
              }}
            >
              编辑
            </button>
            <button
              className="text-button"
              aria-label={`删除任务：${task.title}`}
              disabled={disabled}
              onClick={() => setDeleting(true)}
            >
              删除
            </button>
          </div>
        </>
      )}
      {deleting ? (
        <Modal
          className="profile-dialog"
          onCancel={() => setDeleting(false)}
          aria-label="确认删除任务"
        >
          <h2>删除这个任务？</h2>
          <p>“{task.title}”将移除，完成数和总数也会扣除，无法撤销。</p>
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setDeleting(false)}>
              保留任务
            </button>
            <button
              className="button danger"
              disabled={disabled}
              onClick={async () => {
                if (await run('task:delete', { taskId: task.id, version: task.version }))
                  setDeleting(false);
              }}
            >
              确认删除
            </button>
          </div>
        </Modal>
      ) : null}
    </li>
  );
}

export function ChatPanel({
  data,
  messages,
  disabled,
  command,
}: {
  data: RoomSnapshot;
  messages: ChatMessage[];
  disabled: boolean;
  command: Command;
}) {
  const { user } = useAuth();
  const [draft, setDraft] = useDraft(user!.id + ':' + data.room.id + ':chat', '');
  const [cooldown, setCooldown] = useState(false);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(false), 2000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const lastMessage = useRef('');
  const [unread, setUnread] = useState(false);
  const scrollBottom = () => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
    nearBottom.current = true;
    setUnread(false);
  };
  const isBreak = data.session.phase === 'BREAK';
  useEffect(() => {
    const latest = messages.at(-1)?.id ?? '';
    if (isBreak && nearBottom.current) scrollBottom();
    else if (latest !== lastMessage.current && lastMessage.current) setUnread(true);
    lastMessage.current = latest;
  }, [messages, isBreak]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy || cooldown || disabled || !data.myPermissions.canChat || !draft.trim()) return;
    setBusy(true);
    setError('');
    try {
      await command('chat:send', { content: draft });
      setDraft('');
      setCooldown(true);
      scrollBottom();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={`panel chat-panel ${isBreak ? 'chat-open' : 'chat-locked'}`}>
      <div className="panel-heading">
        <h2>休息聊天室</h2>
        <span>{isBreak ? '可以聊聊' : '休息时间开放聊天'}</span>
      </div>
      {isBreak ? (
        <>
          <p className="muted">
            本轮专注 {Math.floor(data.feedback.roundFocusSeconds / 60)} 分{' '}
            {data.feedback.roundFocusSeconds % 60} 秒 · 推进了 {data.feedback.roundTasksDone ?? '—'}{' '}
            个任务。
          </p>
          <div
            ref={list}
            onScroll={() => {
              const el = list.current;
              if (el) {
                nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                if (nearBottom.current) setUnread(false);
              }
            }}
            className="chat-messages"
            role="log"
            aria-label="聊天室消息列表"
            aria-live="polite"
          >
            {!messages.length ? <p className="muted">休息一下，和搭子分享刚刚的进展吧。</p> : null}
            {messages.map((message) => (
              <article key={message.id}>
                <strong>{message.nickname}</strong>
                <time>
                  {new Date(message.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
                <p>{message.content}</p>
              </article>
            ))}
          </div>
          {unread ? (
            <button className="text-button" onClick={scrollBottom}>
              有新消息 · 回到最新
            </button>
          ) : null}
        </>
      ) : (
        <p className="muted">
          {data.session.phase === 'ENDED' ? '本次共学已结束。' : '专注时安静陪伴，休息时再交流。'}
        </p>
      )}
      <form onSubmit={send} hidden={!isBreak}>
        <label>
          休息消息
          <textarea
            name="message"
            aria-label="休息消息"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
            required
            disabled={disabled || busy || !data.myPermissions.canChat}
            placeholder="和搭子分享一下进展…"
          />
        </label>
        <div className="chat-compose-footer">
          <small>{draft.length}/500 · 每 2 秒一条</small>
          <button
            className="button primary"
            disabled={disabled || busy || cooldown || !data.myPermissions.canChat || !draft.trim()}
          >
            {busy ? '发送中…' : cooldown ? '稍等 2 秒' : error ? '重试发送' : '发送消息'}
          </button>
        </div>
        {error ? <Notice>{error} · 草稿已保留，请手动重试，不会自动补发。</Notice> : null}
      </form>
    </section>
  );
}

export function SummaryPanel({ summary }: { summary: SessionSummary }) {
  const { pathname } = useLocation();
  const r = summary.record;
  const reasons: Record<string, string> = {
    ADMIN_ENDED: '管理员结束共学',
    USER_BANNED: '房主被封禁且无人可接任',
    OWNER_ENDED: '房主主动结束',
    OWNER_LEFT: '房主离开',
    OWNER_DISCONNECTED: '房主断线超时',
    ROUNDS_COMPLETED: '已完成设定轮数',
  };
  return (
    <section className="panel summary-panel">
      <span className="eyebrow">SESSION SUMMARY</span>
      <h2>这次相聚先到这里</h2>
      <RewardFeedback reward={summary.reward} />
      <p className="muted">
        {summary.startedAt
          ? `${reasons[summary.endReason ?? ''] ?? '共学结束'} · 房间完成 ${summary.roomRoundsCompleted} 轮专注`
          : '在大厅结束，未开始专注计时。'}{' '}
        · 结果已保存
      </p>
      <p className="muted">
        {summary.demoMode ? '演示记录 · 不计入正式累计' : '正式学习记录'} · 房间共同专注{' '}
        {summary.roomFocusSeconds ?? '无法还原'} 秒（至少两人同时有效专注）
      </p>
      {!summary.recordAvailable ? <Notice>旧记录缺少可靠结算，以下指标不可还原。</Notice> : null}
      {summary.recordAvailable ? (
        <div className="summary-metrics">
          <div>
            <strong>
              {Math.floor(r.focusSeconds / 60)}
              <small>分</small>
              {r.focusSeconds % 60}
              <small>秒</small>
            </strong>
            <span>我的有效专注</span>
          </div>
          <div>
            <strong>{r.roundsCompleted}</strong>
            <span>完整参与轮次</span>
          </div>
          <div>
            <strong>
              {r.tasksDone} / {r.tasksTotal}
            </strong>
            <span>
              完成任务 · {r.progressPercent === null ? '未设置任务' : `${r.progressPercent}%`}
            </span>
          </div>
          <div>
            <strong>{r.studiedWith}</strong>
            <span>共同专注的搭子</span>
          </div>
        </div>
      ) : null}
      {summary.analysis.tasks.length ? (
        <div className="session-analysis">
          <div className="panel-heading">
            <h3>本次数据分析</h3>
            <Link className="text-button" to="/analytics">
              查看完整统计 ↗
            </Link>
          </div>
          <div className="session-analysis-grid">
            <div>
              <span>标签分布</span>
              {summary.analysis.labels.slice(0, 4).map((item) => (
                <p key={item.label}>
                  <strong>#{item.label}</strong>
                  <span>
                    {Math.floor(item.focusSeconds / 60)} 分 · {item.tasksDone}/{item.tasksTotal}
                  </span>
                </p>
              ))}
            </div>
            <div>
              <span>任务推进</span>
              {summary.analysis.tasks.slice(0, 4).map((task, index) => (
                <p key={`${task.title}-${index}`}>
                  <strong className={task.completed ? 'task-done' : ''}>{task.title}</strong>
                  <span>{task.completed ? '已完成' : '待继续'}</span>
                </p>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      <p className="muted">专注时长只计在线且非暂离的时间；迟到、暂离或断线的轮次不算完整参与。</p>
      <div className="summary-actions">
        <Link className="button primary" to="/">
          回到首页 ↗
        </Link>
        <Link
          className="text-button"
          to={pathname.endsWith('/summary') ? '/history' : `/sessions/${summary.sessionId}/summary`}
        >
          {pathname.endsWith('/summary') ? '查看学习历史' : '打开已保存结果'}
        </Link>
      </div>
    </section>
  );
}
