import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  AdminAction,
  AdminImpact,
  AdminMessage,
  AdminOverview,
  AdminRoom,
  AdminUser,
  Audit,
  Page,
} from '@focusspace/shared';
import { api, errorMessage, RequestError } from '../api';
import { createRequestId } from '../requestId';
import { useAuth } from '../auth';
import { Modal, Notice } from '../components';
import { phaseNames } from '../features/PublicRooms';
import { useListLocation } from '../navigation';
type Tab = 'overview' | 'users' | 'rooms' | 'messages' | 'audits';
const tabs: [Tab, string][] = [
  ['overview', '管理概览'],
  ['users', '用户管理'],
  ['rooms', '房间与 Session'],
  ['messages', '有限期消息'],
  ['audits', '操作审计'],
];
const actionNames = {
  'user:ban': '封禁用户',
  'user:unban': '解封用户',
  'room:delist': '下架公开房间',
  'room:end': '强制结束',
  'message:remove': '移除原文',
};
const time = (s: string | null) => (s ? new Date(s).toLocaleString('zh-CN') : '—');
export function AdminPage() {
  const { user } = useAuth();
  const location = useListLocation();
  const { page } = location;
  const tab: Tab = tabs.find(([id]) => id === location.get('tab'))?.[0] ?? 'overview';
  const search = location.get('q');
  const phase = location.get('phase');
  const [q, setQ] = useState(search);
  useEffect(() => setQ(search), [search, tab]);
  const [data, setData] = useState<
    AdminOverview | Page<AdminUser | AdminRoom | AdminMessage | Audit> | null
  >(null);
  const [loadedTab, setLoadedTab] = useState<Tab>('overview');
  const [version, setVersion] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const [pending, setPending] = useState<{
      action: AdminAction['action'];
      targetId: string;
      impact: AdminImpact;
      requestId: string;
    } | null>(null),
    [reason, setReason] = useState('');
  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    let alive = true;
    setData(null);
    setError('');
    void api<NonNullable<typeof data>>(
      '/admin/' +
        tab +
        '?' +
        new URLSearchParams({
          page: String(page),
          q: search,
          ...(tab === 'rooms' ? { phase } : {}),
        }),
    )
      .then((d) => {
        if (alive) {
          setLoadedTab(tab);
          setData(d);
        }
      })
      .catch((e) => {
        if (alive) {
          setData(null);
          setError(errorMessage(e));
        }
      });
    return () => {
      alive = false;
    };
  }, [tab, page, search, phase, version, user?.role]);
  async function preview(action: AdminAction['action'], targetId: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const impact = await api<AdminImpact>('/admin/preview', {
        method: 'POST',
        body: { action, targetId },
      });
      setReason('');
      setPending({ action, targetId, impact, requestId: createRequestId() });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!pending || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ auditId: string }>('/admin/actions', {
        method: 'POST',
        body: {
          action: pending.action,
          targetId: pending.targetId,
          impactKey: pending.impact.impactKey,
          requestId: pending.requestId,
          reason,
        },
      });
      setPending(null);
      setNotice('操作已完成，审计编号：' + result.auditId);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof RequestError && e.code === 'IMPACT_CHANGED') setPending(null);
    } finally {
      setBusy(false);
    }
  }
  if (user?.role !== 'ADMIN')
    return (
      <section className="empty-state">
        <h1>仅管理员可访问</h1>
        <Link to="/">返回我的空间</Link>
      </section>
    );
  const list = data && loadedTab === tab && 'items' in data ? data : null;
  const overview = data && loadedTab === tab && 'connections' in data ? data : null;
  return (
    <div className="admin-page">
      <Link to="/">← 我的空间</Link>
      <span className="eyebrow">FOCUSSPACE ADMIN</span>
      <h1>管理共学空间</h1>
      <p className="muted">
        管理账号、公共入口与有限期消息。私人任务标题保持私有，学习历史仅由共学服务结算。
      </p>
      <nav className="admin-tabs" aria-label="管理栏目">
        {tabs.map(([id, label]) => (
          <Link
            key={id}
            aria-current={tab === id ? 'page' : undefined}
            className={'button ' + (tab === id ? 'primary' : 'secondary')}
            to={id === 'overview' ? '/admin' : `/admin?tab=${id}`}
            aria-disabled={busy || undefined}
            onClick={(event) => {
              if (busy) event.preventDefault();
            }}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="directory-filters">
        {tab !== 'overview' ? (
          <form
            className="directory-filters"
            onSubmit={(e) => {
              e.preventDefault();
              location.update({ page: 1, q: q.trim() });
              setVersion((v) => v + 1);
            }}
          >
            <label>
              {tab === 'users'
                ? '搜索账号或昵称'
                : tab === 'rooms'
                  ? '搜索房间主题'
                  : tab === 'messages'
                    ? '按房间 ID 筛选'
                    : '按操作者或对象 ID 筛选'}
              <input
                type="search"
                name="adminSearch"
                autoComplete="off"
                value={q}
                maxLength={80}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            {tab === 'rooms' ? (
              <label>
                Session 阶段
                <select
                  value={phase}
                  onChange={(e) => {
                    location.update({ page: 1, phase: e.target.value });
                  }}
                >
                  <option value="">全部</option>
                  {Object.entries(phaseNames).map(([v, l]) => (
                    <option value={v} key={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button className="button secondary">搜索</button>
          </form>
        ) : null}
        <button className="text-button" disabled={busy} onClick={() => setVersion((v) => v + 1)}>
          刷新数据
        </button>
      </div>
      {notice ? (
        <p role="status" className="notice notice-success">
          {notice}
        </p>
      ) : null}
      {error && !pending ? <Notice>{error}</Notice> : null}
      {!data && !error ? <p role="status">正在读取管理数据…</p> : null}
      {overview ? (
        <>
          <div className="admin-metrics">
            {(
              [
                ['实时连接数', overview.connections],
                ['在线用户', overview.onlineUsers],
                ['活跃房间', overview.activeRooms],
                ['注册用户', overview.users],
                ['封禁用户', overview.bannedUsers],
                ['公开房间', overview.publicRooms],
                ['进行中 Session', overview.ongoingSessions],
                ['已结束 Session', overview.endedSessions],
                ['24 小时可见消息', overview.retainedMessages],
              ] as const
            ).map(([label, value]) => (
              <article className="panel" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
          <p className="muted">
            连接数按有效实时连接计；在线用户按账号去重；活跃房间为存在实时订阅且尚未结束的房间。多个标签不会增加用户数或房间数。数据为最近一次刷新时的状态。
          </p>
        </>
      ) : null}
      {list?.items.length === 0 ? <p className="empty-state">暂无符合条件的数据。</p> : null}
      {list && tab === 'users' ? (
        <div
          className="admin-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="用户管理列表，可横向滚动"
        >
          <table className="admin-table">
            <thead>
              <tr>
                <th>账号 / 昵称</th>
                <th>角色与状态</th>
                <th>注册时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {(list.items as AdminUser[]).map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.username}</strong>
                    <p>{u.nickname}</p>
                    <small>{u.id}</small>
                  </td>
                  <td>
                    {u.role === 'ADMIN' ? '管理员' : '普通用户'} · {u.bannedAt ? '已封禁' : '正常'}
                    {u.bannedAt ? (
                      <p>
                        {u.banReason} · {time(u.bannedAt)}
                      </p>
                    ) : null}
                  </td>
                  <td>{time(u.createdAt)}</td>
                  <td>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void preview(u.bannedAt ? 'user:unban' : 'user:ban', u.id)}
                    >
                      {u.bannedAt ? '解封' : '封禁'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {list && tab === 'rooms' ? (
        <div className="admin-cards">
          {(list.items as AdminRoom[]).map((r) => (
            <article className="panel" key={r.id}>
              <div className="panel-heading">
                <h2>{r.name}</h2>
                <span>
                  {r.visibility === 'PUBLIC' ? '公开' : '私有'} · {phaseNames[r.session.phase]}
                </span>
              </div>
              <p className="muted">
                房间 {r.id}
                <br />
                Session {r.session.id} · 第 {r.session.roundNo} 轮 · {r.session.focusSeconds}/
                {r.session.breakSeconds} 秒
              </p>
              <p>
                {r.members.length}/{r.capacity} 名成员 · 结束时间 {time(r.session.endedAt)}{' '}
                {r.session.endReason}
              </p>
              <ul>
                {r.members.map((m) => (
                  <li key={m.userId}>
                    {m.nickname} {m.userId === r.ownerId ? '（房主）' : ''} · 座位 {m.seatIndex + 1}{' '}
                    · {m.connectionState === 'CONNECTED' ? '在线' : '断线'}
                    {m.afk ? ' · 暂离' : ''}
                  </li>
                ))}
              </ul>
              <div className="owner-actions">
                <button
                  className="button secondary"
                  disabled={busy || r.visibility !== 'PUBLIC' || r.session.phase === 'ENDED'}
                  onClick={() => void preview('room:delist', r.id)}
                >
                  下架公开房间
                </button>
                <button
                  className="button secondary"
                  disabled={busy || r.session.phase === 'ENDED'}
                  onClick={() => void preview('room:end', r.id)}
                >
                  强制结束
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {list && tab === 'messages' ? (
        <>
          <p className="muted">
            仅保留最近 24 小时的房间聊天。移除后不保留原文副本，审计仅记录对象和原因。
          </p>
          <div className="admin-cards">
            {(list.items as AdminMessage[]).map((m) => (
              <article className="panel" key={m.id}>
                <strong>{m.nickname}</strong>
                <p className="message-content">{m.content}</p>
                <p className="muted">
                  {time(m.createdAt)} · 房间 {m.roomId}
                  <br />
                  消息 {m.id}
                </p>
                <button
                  className="button secondary"
                  disabled={busy || !!m.removedAt}
                  onClick={() => void preview('message:remove', m.id)}
                >
                  {m.removedAt ? '已移除' : '移除原文'}
                </button>
              </article>
            ))}
          </div>
        </>
      ) : null}
      {list && tab === 'audits' ? (
        <div className="admin-cards">
          {(list.items as Audit[]).map((a) => (
            <article className="panel" key={a.id}>
              <strong>
                {a.action} · {a.result === 'SUCCESS' ? '成功' : '失败'}
              </strong>
              <p>{a.summary}</p>
              <p>原因：{a.reason}</p>
              <p className="muted">
                操作者 {a.actorId}
                <br />
                对象 {a.targetId}
                <br />
                {time(a.createdAt)} · 审计 {a.id}
              </p>
            </article>
          ))}
        </div>
      ) : null}
      {list && list.total > list.pageSize ? (
        <div className="pagination">
          <button
            className="button secondary"
            disabled={page <= 1 || busy}
            onClick={() => location.update({ page: page - 1 })}
          >
            上一页
          </button>
          <span>
            第 {page} 页 · 共 {list.total} 条
          </span>
          <button
            className="button secondary"
            disabled={page * list.pageSize >= list.total || busy}
            onClick={() => location.update({ page: page + 1 })}
          >
            下一页
          </button>
        </div>
      ) : null}
      {pending ? (
        <Modal
          className="profile-dialog admin-confirm"
          onCancel={(e) => {
            if (busy) e.preventDefault();
            else setPending(null);
          }}
          aria-labelledby="admin-confirm-title"
        >
          <h2 id="admin-confirm-title">确认{actionNames[pending.action]}</h2>
          <p>{pending.impact.description}</p>
          <p className="muted">对象：{pending.targetId}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void commit();
            }}
          >
            <label>
              操作原因
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={2}
                maxLength={300}
                required
                disabled={busy}
                placeholder="说明处理依据，请勿粘贴密码、令牌或私有正文"
              />
            </label>
            {error ? <Notice>{error}</Notice> : null}
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                取消
              </button>
              <button className="button primary" disabled={busy || reason.trim().length < 2}>
                {busy ? '正在处理…' : '确认执行'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
