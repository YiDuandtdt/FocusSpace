import { createRequestId } from '../requestId';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { roomRequest, errorMessage } from '../api';
import { Notice, RhythmFields } from '../components';

import { readPreferences, savePreferences } from '../preferences';
import { PublicRooms } from '../features/PublicRooms';
import { HistoryPage } from './HistoryPage';

export function HomePage() {
  const { user, currentRoomId, refresh } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'PRIVATE' | 'PUBLIC'>('PRIVATE');
  const [focus, setFocus] = useState(() => readPreferences(user!.id).focusSeconds / 60);
  const [rest, setRest] = useState(() => readPreferences(user!.id).breakSeconds / 60);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [saved, setSaved] = useState('');
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
              visibility,
              focusSeconds: focus * 60,
              breakSeconds: rest * 60,
              requestId: createRequestId(),
            }
          : { code, requestId: createRequestId() };
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
      <section className="personal-space-entry">
        <div>
          <span className="eyebrow">YOUR OWN READING ROOM</span>
          <h2>把喜欢的样子，留在这里。</h2>
          <p>装扮虚拟形象，布置个人自习室。发起共学时，用你的空间接待朋友。</p>
        </div>
        <Link to="/space" className="button primary">
          进入个人空间 ↗
        </Link>
      </section>
      <section className="entry-grid" id="room-entry" aria-label="创建或加入房间">
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
          <p className="muted">
            使用已保存的个人空间接待朋友，最多 8 人。<Link to="/space">先看看布置</Link>
          </p>
          <label>
            房间名称
            <input
              placeholder="例如：今晚一起读书"
              name="roomName"
              autoComplete="off"
              pattern=".*\S.*"
              title="请输入房间名称，不能只包含空格"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              required
            />
          </label>
          <label>
            房间可见性
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'PRIVATE' | 'PUBLIC')}
            >
              <option value="PRIVATE">私有 · 通过房间码邀请</option>
              <option value="PUBLIC">公开 · 首页展示，其他用户可加入</option>
            </select>
          </label>
          <RhythmFields focus={focus} rest={rest} setFocus={setFocus} setRest={setRest} />
          <details className="preference-details">
            <summary>保存常用节奏</summary>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                if (
                  focus >= 1 &&
                  focus <= 180 &&
                  rest >= 1 &&
                  rest <= 60 &&
                  Number.isInteger(focus) &&
                  Number.isInteger(rest)
                )
                  setSaved(
                    savePreferences(user!.id, { focusSeconds: focus * 60, breakSeconds: rest * 60 })
                      ? '默认节奏已保存，仅用于新建房间。'
                      : '浏览器未允许保存偏好。',
                  );
                else setSaved('请输入范围内的整数分钟。');
              }}
            >
              保存为默认节奏
            </button>
            <p className="muted" role="status">
              {saved || '下次创建时使用此节奏；加入房间时跟随房主。'}
            </p>
          </details>
          {currentRoomId ? <p className="muted">已有共学进行中，返回当前房间后即可继续。</p> : null}
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
                name="roomCode"
                pattern="[A-HJ-NP-Z2-9]{6}"
                title="请输入 6 位房间码，不含 I、O、0、1"
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
              <p>专注时各自推进，休息时聊聊进展。最多 8 个座位，共享同一个学习节奏。</p>
            </div>
          </aside>
        </div>
      </section>
      <PublicRooms />
      <HistoryPage recent />
    </div>
  );
}
