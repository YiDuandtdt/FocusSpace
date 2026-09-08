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
    <section className="empty-state">
      <span className="eyebrow">A SEAT IS WAITING</span>
      <h1>朋友邀请你一起专注</h1>
      <p>房间码：{code}</p>
      <p>加入后立即同步当前阶段，仅计算实际参与时间。可以在大厅或进行中添加任务。</p>
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
