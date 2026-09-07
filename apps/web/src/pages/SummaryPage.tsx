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
  }, [sessionId]);
  return (
    <div className="room-page">
      <Link className="text-button" to="/">
        ← 我的空间
      </Link>
      {data ? (
        <>
          <h1>{data.roomName}</h1>
          <SummaryPanel summary={data} />
        </>
      ) : error ? (
        <Notice>{error}</Notice>
      ) : (
        <p>正在读取已保存结果…</p>
      )}
    </div>
  );
}
