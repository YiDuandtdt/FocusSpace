import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Todo } from '@focusspace/shared';
import { api, errorMessage } from '../api';
import { Notice } from '../components';
import { useAuth } from '../auth';

const priorityText = { HIGH: '高', MEDIUM: '中', LOW: '低' } as const;
const recurrenceText = { NONE: '不重复', DAILY: '每天', WEEKLY: '每周' } as const;
const pad = (value: number) => String(value).padStart(2, '0');
const dateInput = (value: number | null) => {
  if (!value) return '';
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const dateTimeInput = (value: number | null) => {
  if (!value) return '';
  const date = new Date(value);
  return `${dateInput(value)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const iso = (value: string) => (value ? new Date(value).toISOString() : null);
const dueIso = (value: string) => (value ? new Date(`${value}T23:59:00`).toISOString() : null);

type Draft = {
  title: string;
  parentId: string;
  priority: Todo['priority'];
  dueAt: string;
  scheduledStart: string;
  scheduledEnd: string;
  labels: string;
  recurrence: Todo['recurrence'];
};
const emptyDraft = (): Draft => ({
  title: '',
  parentId: '',
  priority: 'MEDIUM',
  dueAt: '',
  scheduledStart: '',
  scheduledEnd: '',
  labels: '',
  recurrence: 'NONE',
});

function flatten(items: Todo[], depth = 0): { item: Todo; depth: number }[] {
  return items.flatMap((item) => [
    { item, depth },
    ...flatten(item.children, Math.min(depth + 1, 5)),
  ]);
}

export function TodoPage() {
  const { currentRoomId } = useAuth();
  const [items, setItems] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [details, setDetails] = useState(false);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const titleRef = useRef<HTMLInputElement>(null);
  const flat = useMemo(() => flatten(items), [items]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api<{ items: Todo[] }>('/users/me/todos');
      setItems(data.items);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy('create');
    setError('');
    try {
      await api<Todo>('/users/me/todos', {
        method: 'POST',
        body: {
          title: draft.title,
          parentId: draft.parentId || null,
          priority: draft.priority,
          dueAt: dueIso(draft.dueAt),
          scheduledStart: iso(draft.scheduledStart),
          scheduledEnd: iso(draft.scheduledEnd),
          labels: draft.labels
            .split(/[,，]/)
            .map((label) => label.trim())
            .filter(Boolean),
          recurrence: draft.recurrence,
        },
      });
      setDraft(emptyDraft());
      setDetails(false);
      setNotice('已加入待办清单');
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  }

  async function update(item: Todo, body: Record<string, unknown>) {
    setBusy(item.id);
    setError('');
    try {
      await api<Todo>(`/users/me/todos/${item.id}`, {
        method: 'PATCH',
        body: { version: item.version, ...body },
      });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  }

  async function remove(item: Todo) {
    setBusy(item.id);
    setError('');
    try {
      await api(`/users/me/todos/${item.id}`, {
        method: 'DELETE',
        body: { version: item.version },
      });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  }

  async function addToRoom(item: Todo) {
    if (!currentRoomId) return;
    setBusy(item.id);
    setError('');
    try {
      await api(`/users/me/todos/${item.id}/room`, {
        method: 'POST',
        body: { roomId: currentRoomId, requestId: crypto.randomUUID() },
      });
      setNotice(`“${item.title}”已加入当前房间，完成状态会双向同步。`);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  }

  const monthItems = flat
    .map(({ item }) => item)
    .filter((item) => item.scheduledStart || item.dueAt);
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(1 - offset);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [month]);

  return (
    <div className="planning-page todo-page">
      <div className="planning-heading">
        <div>
          <span className="eyebrow">PLAN WITH INTENTION</span>
          <h1>待办清单</h1>
          <p>把长期计划带进每一次共学，完成进度会在清单和房间之间同步。</p>
        </div>
        {currentRoomId ? (
          <Link className="button secondary" to={`/rooms/${currentRoomId}`}>
            回到当前房间
          </Link>
        ) : null}
      </div>

      <form className="todo-composer" onSubmit={create}>
        <input
          ref={titleRef}
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          placeholder="添加一项待办…"
          maxLength={200}
          required
        />
        <select
          aria-label="优先级"
          value={draft.priority}
          onChange={(event) =>
            setDraft({ ...draft, priority: event.target.value as Todo['priority'] })
          }
        >
          <option value="HIGH">高优先级</option>
          <option value="MEDIUM">中优先级</option>
          <option value="LOW">低优先级</option>
        </select>
        <button
          type="button"
          className="text-button"
          aria-expanded={details}
          onClick={() => setDetails(!details)}
        >
          日期与更多
        </button>
        <button className="button primary" disabled={busy === 'create' || !draft.title.trim()}>
          {busy === 'create' ? '添加中…' : '添加'}
        </button>
        {details ? (
          <div className="todo-composer-details">
            <label>
              截止日期
              <input
                type="date"
                value={draft.dueAt}
                onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })}
              />
            </label>
            <label>
              日程开始
              <input
                type="datetime-local"
                value={draft.scheduledStart}
                onChange={(event) => setDraft({ ...draft, scheduledStart: event.target.value })}
              />
            </label>
            <label>
              日程结束
              <input
                type="datetime-local"
                value={draft.scheduledEnd}
                onChange={(event) => setDraft({ ...draft, scheduledEnd: event.target.value })}
              />
            </label>
            <label>
              重复
              <select
                value={draft.recurrence}
                onChange={(event) =>
                  setDraft({ ...draft, recurrence: event.target.value as Todo['recurrence'] })
                }
              >
                <option value="NONE">不重复</option>
                <option value="DAILY">每天</option>
                <option value="WEEKLY">每周</option>
              </select>
            </label>
            <label>
              标签
              <input
                value={draft.labels}
                onChange={(event) => setDraft({ ...draft, labels: event.target.value })}
                placeholder="课程，论文"
              />
            </label>
            <label>
              作为子任务
              <select
                value={draft.parentId}
                onChange={(event) => setDraft({ ...draft, parentId: event.target.value })}
              >
                <option value="">无上级任务</option>
                {flat
                  .filter(({ depth }) => depth < 5)
                  .map(({ item, depth }) => (
                    <option key={item.id} value={item.id}>
                      {'　'.repeat(depth)}
                      {item.title}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        ) : null}
      </form>

      {error ? <Notice>{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      <div className="view-switch" role="tablist" aria-label="待办视图">
        <button role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}>
          清单
        </button>
        <button role="tab" aria-selected={view === 'calendar'} onClick={() => setView('calendar')}>
          日历
        </button>
      </div>

      {loading ? (
        <section className="panel" role="status">
          正在读取待办…
        </section>
      ) : view === 'list' ? (
        <section className="todo-list-panel">
          <div className="todo-list-summary">
            <strong>{flat.filter(({ item }) => !item.completed).length}</strong>
            <span>项待完成</span>
            <small>{currentRoomId ? '可加入当前房间' : '进入房间后可关联任务'}</small>
          </div>
          {!flat.length ? (
            <div className="journal-empty">
              <h2>清单还是空的</h2>
              <p>先写下下一件要推进的事。</p>
            </div>
          ) : (
            <ul className="todo-items">
              {flat.map(({ item, depth }) => (
                <li
                  key={item.id}
                  className={item.completed ? 'is-done' : ''}
                  style={{ '--todo-depth': depth } as CSSProperties}
                >
                  <input
                    type="checkbox"
                    checked={item.completed}
                    disabled={busy === item.id}
                    aria-label={`完成：${item.title}`}
                    onChange={(event) => void update(item, { completed: event.target.checked })}
                  />
                  <div className="todo-main">
                    <strong>{item.title}</strong>
                    <div className="todo-meta">
                      <span className={`priority priority-${item.priority.toLowerCase()}`}>
                        {priorityText[item.priority]}优先级
                      </span>
                      {item.dueAt ? (
                        <time>截止 {new Date(item.dueAt).toLocaleDateString()}</time>
                      ) : null}
                      {item.scheduledStart ? (
                        <time>
                          {new Date(item.scheduledStart).toLocaleString([], {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                      ) : null}
                      {item.recurrence !== 'NONE' ? (
                        <span>↻ {recurrenceText[item.recurrence]}</span>
                      ) : null}
                      {item.labels.map((label) => (
                        <span className="todo-label" key={label}>
                          #{label}
                        </span>
                      ))}
                      {item.linkedRoomId ? <span className="linked-badge">已同步房间</span> : null}
                    </div>
                  </div>
                  <div className="todo-actions">
                    <button
                      className="text-button"
                      onClick={() => {
                        setDraft({ ...emptyDraft(), parentId: item.id });
                        setDetails(true);
                        titleRef.current?.focus();
                      }}
                    >
                      添加子任务
                    </button>
                    {currentRoomId && !item.linkedRoomId ? (
                      <button
                        className="text-button"
                        disabled={busy === item.id}
                        onClick={() => void addToRoom(item)}
                      >
                        加入房间
                      </button>
                    ) : null}
                    {item.linkedRoomId ? (
                      <Link className="text-button" to={`/rooms/${item.linkedRoomId}`}>
                        查看房间
                      </Link>
                    ) : null}
                    <button
                      className="text-button"
                      disabled={busy === item.id}
                      onClick={() => void remove(item)}
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="calendar-panel">
          <div className="calendar-toolbar">
            <button
              className="text-button"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            >
              ← 上月
            </button>
            <h2>
              {month.getFullYear()} 年 {month.getMonth() + 1} 月
            </h2>
            <button
              className="text-button"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            >
              下月 →
            </button>
          </div>
          <div className="calendar-weekdays">
            {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
              <span key={day}>周{day}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {days.map((day) => {
              const key = dateInput(day.getTime());
              const matches = monthItems.filter(
                (item) => dateInput(item.scheduledStart ?? item.dueAt) === key,
              );
              return (
                <div
                  key={key}
                  className={`${day.getMonth() === month.getMonth() ? '' : 'outside'} ${key === dateInput(Date.now()) ? 'today' : ''}`}
                >
                  <time>{day.getDate()}</time>
                  {matches.slice(0, 3).map((item) => (
                    <button
                      key={item.id}
                      className={`calendar-item priority-${item.priority.toLowerCase()}`}
                      title={item.title}
                      onClick={() => setView('list')}
                    >
                      {item.scheduledStart
                        ? new Date(item.scheduledStart).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          }) + ' '
                        : ''}
                      {item.title}
                    </button>
                  ))}
                  {matches.length > 3 ? <small>还有 {matches.length - 3} 项</small> : null}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
