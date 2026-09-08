import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { roomRequest, errorMessage } from '../api';
import { Notice, RhythmFields } from '../components';

export function HomePage() {
  const { user, currentRoomId, refresh } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [focus, setFocus] = useState(25);
  const [rest, setRest] = useState(5);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function enter(event: FormEvent, mode: 'create' | 'join') {
    event.preventDefault();
    if (busy || currentRoomId) return;
    setBusy(mode);
    setError('');
    try {
      const body =
        mode === 'create'
          ? {
              name,
              focusSeconds: focus * 60,
              breakSeconds: rest * 60,
              requestId: crypto.randomUUID(),
            }
          : { code, requestId: crypto.randomUUID() };
      const result = await roomRequest(mode === 'create' ? '/rooms' : '/rooms/join', body);
      await refresh();
      navigate(`/rooms/${result.roomId}`);
    } catch (e) {
      setError(errorMessage(e));
      // A timed-out request may have committed; expose the current-room return path.
      await refresh();
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="home-page">
      <section className="home-intro">
        <div>
          <span className="eyebrow">YOUR QUIET CORNER</span>
          <h1>
            你好，{user?.nickname}。<br />
            <span>今天，和谁一起专注？</span>
          </h1>
          <p>打开一个安静的空间，把房间码分享给学习搭子。</p>
        </div>
        <div className="intro-note">
          <span className="note-symbol" aria-hidden="true">
            ⌁
          </span>
          <p>
            不必一个人，
            <br />
            也不必一直交谈。
          </p>
          <span>各自学习 · 共同在场</span>
        </div>
      </section>
      {currentRoomId ? (
        <div className="return-room">
          <div>
            <strong>你有一个正在参与的房间</strong>
            <p>返回即可恢复成员列表与学习节奏。</p>
          </div>
          <Link className="button primary" to={`/rooms/${currentRoomId}`}>
            返回房间 ↗
          </Link>
        </div>
      ) : null}
      {error ? <Notice>{error}</Notice> : null}
      <section className="entry-grid">
        <form className="panel create-panel" onSubmit={(event) => void enter(event, 'create')}>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">MAKE SOME SPACE</span>
              <h2>创建自习房间</h2>
            </div>
            <span className="panel-symbol" aria-hidden="true">
              ＋
            </span>
          </div>
          <p className="muted">为你和朋友留一张桌子，最多 8 人。</p>
          <label>
            房间名称
            <input
              placeholder="例如：今晚一起读书"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              required
            />
          </label>
          <RhythmFields focus={focus} rest={rest} setFocus={setFocus} setRest={setRest} />
          <button className="button primary full" disabled={!!busy || !!currentRoomId}>
            {busy === 'create' ? '正在创建…' : '创建房间'}
            <span aria-hidden="true">↗</span>
          </button>
        </form>
        <div className="join-column">
          <form className="panel join-panel" onSubmit={(event) => void enter(event, 'join')}>
            <span className="eyebrow">A SEAT IS WAITING</span>
            <h2>加入朋友的房间</h2>
            <p className="muted">输入朋友分享的 6 位房间码。</p>
            <label>
              房间码
              <input
                className="code-input"
                placeholder="ABC234"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
                minLength={6}
                maxLength={6}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </label>
            <button className="button secondary full" disabled={!!busy || !!currentRoomId}>
              {busy === 'join' ? '正在加入…' : '加入房间'}
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <aside className="quiet-note">
            <span className="small-orbit" aria-hidden="true">
              ◌
            </span>
            <div>
              <h3>小房间，刚刚好的陪伴</h3>
              <p>房间仅通过房间码加入。成员到来、准备或暂时离开，都会同步给房间里的每个人。</p>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
