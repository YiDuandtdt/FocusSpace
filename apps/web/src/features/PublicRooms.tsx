import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Page, PublicRoom } from '@focusspace/shared';
import { api, errorMessage, roomRequest } from '../api';
import { createRequestId } from '../requestId';
import { useAuth } from '../auth';
import { Notice } from '../components';
export const phaseNames = {
  LOBBY: '等待开始',
  FOCUS: '正在专注',
  BREAK: '休息时间',
  ENDED: '已结束',
};
export function PublicRooms() {
  const { currentRoomId, refresh } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1),
    [q, setQ] = useState(''),
    [search, setSearch] = useState(''),
    [phase, setPhase] = useState('');
  const [data, setData] = useState<Page<PublicRoom> | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    setError('');
    setData(null);
    void api<Page<PublicRoom>>(
      '/rooms/public?' + new URLSearchParams({ page: String(page), q: search, phase }),
    )
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [page, search, phase, version]);
  async function join(id: string) {
    if (busy) return;
    setBusy(id);
    setError('');
    try {
      const result = await roomRequest('/rooms/public/' + id + '/join', {
        requestId: createRequestId(),
      });
      await refresh();
      navigate('/rooms/' + result.roomId);
    } catch (e) {
      setError(errorMessage(e));
      await refresh();
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="public-directory" aria-labelledby="public-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">STUDY TOGETHER</span>
          <h2 id="public-title">公开共学房间</h2>
        </div>
        <button className="text-button" onClick={reload}>
          刷新列表
        </button>
      </div>
      <p className="muted">
        选择一个主题，立即同步房间当前阶段。从入座连接后开始个人计时，无需等待下一轮。
      </p>
      <form
        className="directory-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(q);
          reload();
        }}
      >
        <label>
          房间主题
          <input
            value={q}
            maxLength={80}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索主题"
          />
        </label>
        <label>
          共学阶段
          <select
            value={phase}
            onChange={(e) => {
              setPage(1);
              setPhase(e.target.value);
            }}
          >
            <option value="">全部阶段</option>
            <option value="LOBBY">等待开始</option>
            <option value="FOCUS">正在专注</option>
            <option value="BREAK">休息时间</option>
          </select>
        </label>
        <button className="button secondary">筛选</button>
      </form>
      {error ? <Notice>{error}</Notice> : null}
      {!data && !error ? <p role="status">正在读取公开房间…</p> : null}
      {data?.total === 0 ? (
        <p className="empty-state">还没有符合条件的公开房间。你可以创建第一个。</p>
      ) : null}
      <div className="public-grid">
        {data?.items.map((r) => (
          <article className="panel public-card" key={r.id}>
            <span className="eyebrow">
              {phaseNames[r.phase]} · {r.members}/{r.capacity} 人
            </span>
            <h3>{r.name}</h3>
            <p>
              专注 {r.focusSeconds / 60} / 休息 {r.breakSeconds / 60} 分钟
            </p>
            <p className="muted">
              下一轮预计：
              {r.nextStartAt
                ? new Date(r.nextStartAt).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })
                : '等待房主开始'}
            </p>
            <button
              className="button secondary full"
              disabled={!!busy || !!currentRoomId || r.members >= r.capacity}
              onClick={() => void join(r.id)}
            >
              {busy === r.id
                ? '正在加入…'
                : r.members >= r.capacity
                  ? '房间已满'
                  : currentRoomId
                    ? '请先返回当前房间'
                    : '加入共学'}
            </button>
          </article>
        ))}
      </div>
      {data ? (
        <div className="pagination">
          <button
            className="button secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </button>
          <span>
            第 {page} 页 · 共 {data.total} 个房间
          </span>
          <button
            className="button secondary"
            disabled={page * data.pageSize >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      ) : null}
    </section>
  );
}
