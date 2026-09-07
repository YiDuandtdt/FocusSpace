import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type {
  ChatMessage,
  RoomCommand,
  RoomSnapshot,
  SessionSummary,
  Task,
} from '@focusspace/shared';
import { Notice } from '../components';
import { errorMessage } from '../api';

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
      <p>
        {remaining === 0
          ? '正在确认下一阶段…'
          : session.phase === 'BREAK' && remaining <= 10
            ? '休息即将结束，准备回到自己的目标。'
            : session.phase === 'FOCUS'
              ? '各自推进，一起认真。'
              : '伸个懒腰，也和搭子聊两句。'}
      </p>
      {session.demoMode ? (
        <small className="demo-label">演示节奏 · 45 秒专注 / 15 秒休息</small>
      ) : null}
    </section>
  );
}

type Command = (type: RoomCommand, payload?: unknown) => Promise<void>;
export function TaskPanel({
  tasks,
  disabled,
  ended,
  command,
}: {
  tasks: Task[];
  disabled: boolean;
  ended: boolean;
  command: Command;
}) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const done = tasks.filter((t) => t.completed).length;
  async function run(type: RoomCommand, payload: unknown) {
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
    if (await run('task:create', { title })) setTitle('');
  }
  return (
    <section className="panel task-panel">
      <div className="panel-heading">
        <h2>我的任务</h2>
        <span>{tasks.length ? `${done} / ${tasks.length}` : '未设置任务'}</span>
      </div>
      <p className="muted">
        标题仅自己可见，搭子只看到完成数量和比例。{ended ? '本次任务已冻结。' : ''}
      </p>
      <progress aria-label="我的任务完成进度" max={tasks.length || 1} value={done} />
      <ul className="task-list">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} disabled={disabled || busy || ended} run={run} />
        ))}
      </ul>
      {!tasks.length ? (
        <p className="muted">给这次共学写下一个小目标。没有任务也可以开始。</p>
      ) : null}
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
        </form>
      ) : null}
      {error ? <Notice>{error}</Notice> : null}
    </section>
  );
}
function TaskRow({
  task,
  disabled,
  run,
}: {
  task: Task;
  disabled: boolean;
  run: (type: RoomCommand, payload: unknown) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const [version, setVersion] = useState(task.version);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (await run('task:update', { taskId: task.id, version, title: draft })) setEditing(false);
  }
  const changed = editing && version !== task.version;
  return (
    <li className="task-row">
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
            onChange={(e) => setDraft(e.target.value)}
          />
          {changed ? (
            <p className="muted">此任务已在其他标签页修改。请取消编辑后重新打开，避免覆盖。</p>
          ) : null}
          <button className="text-button" disabled={disabled || changed}>
            保存
          </button>
          <button type="button" className="text-button" onClick={() => setEditing(false)}>
            取消
          </button>
        </form>
      ) : (
        <>
          <span className={task.completed ? 'task-done' : ''}>{task.title}</span>
          <button
            className="text-button"
            aria-label={`编辑任务：${task.title}`}
            disabled={disabled}
            onClick={() => {
              setDraft(task.title);
              setVersion(task.version);
              setEditing(true);
            }}
          >
            编辑
          </button>
          <button
            className="text-button"
            aria-label={`删除任务：${task.title}`}
            disabled={disabled}
            onClick={() => void run('task:delete', { taskId: task.id, version: task.version })}
          >
            删除
          </button>
        </>
      )}
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
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const isBreak = data.session.phase === 'BREAK';
  useEffect(() => {
    if (isBreak) bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length, isBreak]);
  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await command('chat:send', { content: draft });
      setDraft('');
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
            第 {data.session.roundNo} 轮专注结束 · 当前任务完成{' '}
            {data.myTasks.filter((t) => t.completed).length} / {data.myTasks.length}
          </p>
          <div className="chat-messages" role="log" aria-label="聊天室消息列表" aria-live="polite">
            {!messages.length ? (
              <p className="muted">当前连接还没有新消息。刷新后不补发历史。</p>
            ) : null}
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
            <div ref={bottom} />
          </div>
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
            disabled={disabled || busy || !data.myPermissions.canChat || !draft.trim()}
          >
            发送消息
          </button>
        </div>
        {error ? <Notice>{error}</Notice> : null}
      </form>
    </section>
  );
}

export function SummaryPanel({ summary }: { summary: SessionSummary }) {
  const r = summary.record;
  const reasons: Record<string, string> = {
    OWNER_ENDED: '房主主动结束',
    OWNER_LEFT: '房主离开',
    OWNER_DISCONNECTED: '房主断线超时',
  };
  return (
    <section className="panel summary-panel">
      <span className="eyebrow">SESSION SUMMARY</span>
      <h2>这次相聚先到这里</h2>
      <p className="muted">
        {summary.startedAt
          ? `${reasons[summary.endReason ?? ''] ?? '共学结束'} · 房间完成 ${summary.roomRoundsCompleted} 轮专注`
          : '在大厅结束，未开始专注计时。'}{' '}
        · 结果已保存
      </p>
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
      <p className="muted">专注时长只计在线且非暂离的时间；迟到、暂离或断线的轮次不算完整参与。</p>
      <div className="summary-actions">
        <Link className="button primary" to="/">
          回到首页 ↗
        </Link>
        <Link className="text-button" to={`/sessions/${summary.sessionId}/summary`}>
          打开已保存结果
        </Link>
      </div>
    </section>
  );
}
