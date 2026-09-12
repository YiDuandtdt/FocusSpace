import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { roomRequest, errorMessage } from '../api';
import { createRequestId } from '../requestId';
import { Notice } from '../components';
export function InvitePage() {
  const { code = '' } = useParams();
  const { refresh, currentRoomId } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function join() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await roomRequest('/rooms/join', { code, requestId: createRequestId() });
      await refresh();
      navigate('/rooms/' + result.roomId, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="empty-state invite-page">
      <span className="eyebrow">A SEAT IS WAITING</span>
      <h1>朋友邀请你一起专注</h1>
      <p className="invite-ticket">
        <span>你的入座房间码</span>
        <strong>{code}</strong>
      </p>
      <p>入座后跟随大家的学习节奏，写下目标，就可以一起开始。</p>
      {error ? <Notice>{error}</Notice> : null}
      <button className="button primary" disabled={busy} onClick={() => void join()}>
        {busy ? '正在加入…' : '加入邀请房间'}
      </button>
      {currentRoomId ? (
        <p>
          <Link to={'/rooms/' + currentRoomId}>返回正在参与的房间</Link> · 加入其他房间前需先离开
        </p>
      ) : null}
      <p>
        <Link to="/">返回首页 / 输入房间码</Link>
      </p>
    </section>
  );
}
