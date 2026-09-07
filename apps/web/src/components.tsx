import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AVATARS, type User } from '@focusspace/shared';
import { useAuth } from './auth';
import { api, errorMessage } from './api';

export function Avatar({
  nickname,
  avatarId,
  small = false,
}: {
  nickname: string;
  avatarId: string;
  small?: boolean;
}) {
  return (
    <span aria-hidden="true" className={`avatar avatar-${avatarId} ${small ? 'avatar-small' : ''}`}>
      <span className="avatar-face">
        <i />
        <i />
      </span>
      <span className="avatar-letter">{nickname.slice(0, 1)}</span>
    </span>
  );
}
export function AvatarPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: User['avatarId']) => void;
}) {
  const names = ['湖蓝', '鼠尾草', '浅紫', '日光'];
  return (
    <fieldset className="avatar-picker">
      <legend>选择你的形象</legend>
      <div>
        {AVATARS.map((avatar, i) => (
          <button
            type="button"
            key={avatar}
            className={value === avatar ? 'selected' : ''}
            aria-pressed={value === avatar}
            aria-label={names[i]}
            onClick={() => onChange(avatar)}
          >
            <Avatar avatarId={avatar} nickname="" />
          </button>
        ))}
      </div>
    </fieldset>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="notice" role="alert">
      {children}
    </p>
  );
}
export function Shell({ children }: { children: ReactNode }) {
  const { user, logout, setUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="app-shell">
      <header className="header">
        <Link to="/" className="brand" aria-label="FocusSpace 首页">
          <span className="brand-mark">
            f<span />
          </span>
          FocusSpace<span className="brand-note">共同在场</span>
        </Link>
        <div className="header-actions">
          {user ? (
            <>
              <button className="profile-button" onClick={() => setEditing(true)}>
                <Avatar small nickname={user.nickname} avatarId={user.avatarId} />
                <span>{user.nickname}</span>
              </button>
              <button
                className="text-button"
                onClick={() => void logout().catch((e) => setError(errorMessage(e)))}
              >
                退出登录
              </button>
            </>
          ) : (
            <span className="header-tag">各自学习，一起专注</span>
          )}
        </div>
      </header>
      {error ? <Notice>{error}</Notice> : null}
      <main>{children}</main>
      <footer className="footer">
        <span>FocusSpace</span>
        <span>Study alone, together.</span>
        <span>留一点安静，给正在努力的自己。</span>
      </footer>
      {editing && user ? (
        <Profile user={user} onClose={() => setEditing(false)} onSave={setUser} />
      ) : null}
    </div>
  );
}
function Profile({
  user,
  onClose,
  onSave,
}: {
  user: User;
  onClose: () => void;
  onSave: (user: User) => void;
}) {
  const [nickname, setNickname] = useState(user.nickname);
  const [avatarId, setAvatarId] = useState(user.avatarId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api<{ user: User }>('/users/me', {
        method: 'PATCH',
        body: { nickname, avatarId },
      });
      onSave(data.user);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      className="profile-dialog"
      ref={(node) => {
        if (node && !node.open) node.showModal();
      }}
      onCancel={onClose}
      aria-labelledby="profile-title"
    >
      <form onSubmit={save}>
        <div className="panel-heading">
          <h2 id="profile-title">你的共学形象</h2>
          <button type="button" className="text-button" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <label>
          昵称
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={20}
            required
            autoFocus
          />
        </label>
        <AvatarPicker value={avatarId} onChange={setAvatarId} />
        {error ? <Notice>{error}</Notice> : null}
        <button className="button primary full" disabled={busy}>
          {busy ? '保存中…' : '保存修改'}
        </button>
      </form>
    </dialog>
  );
}
export function RhythmFields({
  focus,
  rest,
  setFocus,
  setRest,
  disabled = false,
}: {
  focus: number;
  rest: number;
  setFocus: (n: number) => void;
  setRest: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="rhythm-fields" disabled={disabled}>
      <legend>学习节奏</legend>
      <div className="rhythm-presets">
        {[
          [25, 5],
          [50, 10],
        ].map(([f, r]) => (
          <button
            key={f}
            type="button"
            aria-pressed={focus === f && rest === r}
            className={focus === f && rest === r ? 'selected' : ''}
            onClick={() => {
              setFocus(f);
              setRest(r);
            }}
          >
            {f} <span>/ {r}</span>
            <small>分钟</small>
          </button>
        ))}
      </div>
      <div className="rhythm-custom">
        <label>
          专注 · 分钟
          <input
            type="number"
            min="1"
            max="180"
            required
            value={focus}
            onChange={(e) => setFocus(Number(e.target.value))}
          />
        </label>
        <label>
          休息 · 分钟
          <input
            type="number"
            min="1"
            max="60"
            required
            value={rest}
            onChange={(e) => setRest(Number(e.target.value))}
          />
        </label>
      </div>
    </fieldset>
  );
}
