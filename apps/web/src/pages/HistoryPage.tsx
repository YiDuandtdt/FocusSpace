import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { HistoryPage as HistoryData } from '@focusspace/shared';
import { api, errorMessage } from '../api';
import { Notice } from '../components';
import { useListLocation } from '../navigation';
export function HistoryPage({ recent = false }: { recent?: boolean }) {
  const location = useListLocation();
  const page = recent ? 1 : location.page;
  const setPage = (next: number) => location.update({ page: next });
  const [data, setData] = useState<HistoryData | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    void api<HistoryData>('/users/me/history?page=' + page)
      .then((v) => {
        if (alive) setData(v);
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [page, attempt]);
  return (
    <section className={`panel history-panel ${recent ? '' : 'history-page'}`}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{recent ? 'RECENT SESSIONS' : 'YOUR STUDY JOURNAL'}</span>
          {recent ? <h2>最近共学</h2> : <h1>我的学习历史</h1>}
        </div>
        <Link to={recent ? '/history' : '/'}>{recent ? '全部历史 ↗' : '返回首页'}</Link>
      </div>
      {error ? (
        <Notice>
          {error}{' '}
          <button className="text-button" onClick={() => setAttempt((a) => a + 1)}>
            重试读取
          </button>
        </Notice>
      ) : !data ? (
        <p className="muted" role="status">
          正在读取学习记录…
        </p>
      ) : (
        <>
          {!recent ? (
            <>
              <div className="history-metrics">
                <div>
                  <span>累计共学</span>
                  <strong>
                    {data.totals.sessions}
                    <small>场</small>
                  </strong>
                </div>
                <div>
                  <span>有效专注</span>
                  <strong>
                    {Math.floor(data.totals.focusSeconds / 60)}
                    <small>分</small>
                    {data.totals.focusSeconds % 60}
                    <small>秒</small>
                  </strong>
                </div>
                <div>
                  <span>完整参与</span>
                  <strong>
                    {data.totals.roundsCompleted}
                    <small>轮</small>
                  </strong>
                </div>
                <div>
                  <span>完成任务</span>
                  <strong>
                    {data.totals.tasksDone}
                    <small>/ {data.totals.tasksTotal}</small>
                  </strong>
                </div>
              </div>
              <p className="muted">
                {data.demoSessions}{' '}
                场演示单独标记，不计入正式累计。这里记录每一场已结束并保存的共学。
              </p>
            </>
          ) : null}
          {!data.total ? (
            <div className="journal-empty">
              <span aria-hidden="true">◷</span>
              <h3>从第一段专注开始</h3>
              <p className="muted">还没有已结算的共学。结束第一场后，在这里回顾。</p>
              <Link className="text-button" to="/#room-entry">
                开始一次共学 →
              </Link>
            </div>
          ) : (
            <ul className="history-list">
              {data.items.slice(0, recent ? 3 : 10).map((s) => (
                <li key={s.sessionId}>
                  <div>
                    <strong>{s.roomName}</strong>
                    <p>
                      {new Date(s.endedAt).toLocaleString()} ·{' '}
                      {s.demoMode ? '演示记录' : '正式记录'} ·{' '}
                      {Math.floor(s.record.focusSeconds / 60)} 分 {s.record.focusSeconds % 60} 秒
                    </p>
                  </div>
                  <Link className="text-button" to={'/sessions/' + s.sessionId + '/summary'}>
                    查看学习总结 ↗
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {!recent && data.total > 10 ? (
            <div className="summary-actions">
              <button
                className="button secondary"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                上一页
              </button>
              <span>
                第 {page} / {Math.ceil(data.total / 10)} 页
              </span>
              <button
                className="button secondary"
                disabled={page * 10 >= data.total}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
