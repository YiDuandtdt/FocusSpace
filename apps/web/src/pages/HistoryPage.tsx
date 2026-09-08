import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { HistoryPage as HistoryData } from '@focusspace/shared';
import { api, errorMessage } from '../api';
import { Notice } from '../components';
export function HistoryPage({ recent = false }: { recent?: boolean }) {
  const [page, setPage] = useState(1);
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
    <section className="panel history-panel">
      <div className="panel-heading">
        <h2>{recent ? '最近共学' : '我的学习历史'}</h2>
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
        <p className="muted">正在读取学习记录…</p>
      ) : (
        <>
          {!recent ? (
            <>
              <p>
                正式累计：{data.totals.sessions} 场 · {Math.floor(data.totals.focusSeconds / 60)} 分{' '}
                {data.totals.focusSeconds % 60} 秒有效专注 · {data.totals.roundsCompleted} 完整轮 ·
                任务 {data.totals.tasksDone}/{data.totals.tasksTotal}
              </p>
              <p className="muted">
                {data.demoSessions}{' '}
                场演示单独标记，不计正式累计。仅列出有已保存结算的场次；旧数据缺失的细节不补造。
              </p>
            </>
          ) : null}
          {!data.total ? (
            <p className="muted">还没有已结算的共学。结束第一场后，在这里回顾。</p>
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
                    查看 Summary ↗
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
                onClick={() => setPage((p) => p - 1)}
              >
                上一页
              </button>
              <span>
                第 {page} / {Math.ceil(data.total / 10)} 页
              </span>
              <button
                className="button secondary"
                disabled={page * 10 >= data.total}
                onClick={() => setPage((p) => p + 1)}
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
