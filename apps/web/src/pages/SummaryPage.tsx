import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { SessionSummary } from '@focusspace/shared';
import { api, errorMessage } from '../api';
import { Notice } from '../components';
import { SummaryPanel } from '../features/SessionPanels';

export function SummaryPage() {
  const { sessionId } = useParams();
  const [data, setData] = useState<SessionSummary | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    void api<SessionSummary>(`/sessions/${sessionId}/summary`)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [sessionId, attempt]);
  return (
    <div className="summary-page">
      <Link className="text-button" to="/history">
        ← 学习历史
      </Link>
      {data ? (
        <>
          <div className="page-heading">
            <span className="eyebrow">TIME WELL SPENT</span>
            <h1>{data.roomName}</h1>
            <p className="muted">每一段认真投入，都值得被记住。</p>
          </div>
          <SummaryPanel summary={data} />
        </>
      ) : error ? (
        <Notice>
          {error}{' '}
          <button className="text-button" onClick={() => setAttempt((value) => value + 1)}>
            重新读取结果
          </button>
        </Notice>
      ) : (
        <p role="status">正在读取已保存结果…</p>
      )}
    </div>
  );
}
