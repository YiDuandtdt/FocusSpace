import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link, NavLink } from 'react-router-dom';
import { AVATARS, type User } from '@focusspace/shared';
import { useAuth } from './auth';
import { api, errorMessage } from './api';
import { AvatarUpload } from './features/AvatarUpload';

export function Modal({ children, ...props }: ComponentPropsWithoutRef<'dialog'>) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog {...props} ref={ref}>
      {children}
    </dialog>
  );
}

export function Avatar({
  nickname,
  avatarId,
  small = false,
  avatarUrl,
}: {
  nickname: string;
  avatarId: string;
  small?: boolean;
  avatarUrl?: string | null;
}) {
  return (
    <span aria-hidden="true" className={`avatar avatar-${avatarId} ${small ? 'avatar-small' : ''}`}>
      {avatarUrl ? (
        <img src={avatarUrl} alt="" />
      ) : (
        <>
          <span className="avatar-face">
            <i />
            <i />
          </span>
          <span className="avatar-letter">{nickname.slice(0, 1)}</span>
        </>
      )}
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
      <legend>选择默认头像</legend>
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
export function Notice({
  children,
  tone = 'error',
}: {
  children: ReactNode;
  tone?: 'error' | 'success' | 'info';
}) {
  return (
    <p className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
export function Shell({ children }: { children: ReactNode }) {
  const { user, logout, setUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="header">
        <Link to="/" className="brand" aria-label="FocusSpace 首页">
          <img className="brand-mark" src="/favicon.svg" alt="" />
          FocusSpace<span className="brand-note">共同在场</span>
        </Link>
        <nav className="header-actions" aria-label="主导航">
          {user ? (
            <>
              <NavLink to="/" end className="text-button nav-link">
                共学首页
              </NavLink>
              <NavLink to="/space" className="text-button nav-link">
                个人空间
              </NavLink>
              <NavLink to="/history" className="text-button nav-link">
                学习历史
              </NavLink>
              <NavLink to="/todos" className="text-button nav-link">
                待办清单
              </NavLink>
              <NavLink to="/analytics" className="text-button nav-link">
                数据统计
              </NavLink>
              <NavLink to="/leaderboard" className="text-button nav-link">
                排行榜
              </NavLink>
              {user.role === 'ADMIN' ? (
                <Link to="/admin" className="text-button">
                  管理后台
                </Link>
              ) : null}
              <button
                className="profile-button"
                aria-label={`编辑个人资料：${user.nickname}`}
                onClick={() => setEditing(true)}
              >
                <Avatar
                  small
                  nickname={user.nickname}
                  avatarId={user.avatarId}
                  avatarUrl={user.avatarUrl}
                />
                <span>{user.nickname}</span>
              </button>
              <button
                className="text-button"
                onClick={() => {
                  setError('');
                  setConfirmLogout(true);
                }}
              >
                退出登录
              </button>
            </>
          ) : (
            <span className="header-tag">各自学习，一起专注</span>
          )}
        </nav>
      </header>
      {error ? <Notice>{error}</Notice> : null}
      <main id="main-content" tabIndex={-1} key={user?.id ?? 'anonymous'}>
        {children}
      </main>
      <footer className="footer">
        <span>FocusSpace</span>
        <span>Study alone, together.</span>
        <span>留一点安静，给正在努力的自己。</span>
      </footer>
      {editing && user ? (
        <Profile user={user} onClose={() => setEditing(false)} onSave={setUser} />
      ) : null}
      {confirmLogout ? (
        <Modal
          className="profile-dialog"
          aria-labelledby="logout-title"
          onCancel={(event) => {
            if (loggingOut) event.preventDefault();
            else setConfirmLogout(false);
          }}
        >
          <h2 id="logout-title">退出登录？</h2>
          <p>退出后会断开共学连接，并清除本浏览器中的任务与聊天草稿。</p>
          <p className="muted">
            如果你是房主，断线宽限期结束后会由在线且非暂离的成员接任；无人可接任时结束共学。
          </p>
          {error ? <Notice>{error}</Notice> : null}
          <div className="dialog-actions">
            <button
              className="button secondary"
              disabled={loggingOut}
              onClick={() => setConfirmLogout(false)}
            >
              继续留在这里
            </button>
            <button
              className="button danger"
              disabled={loggingOut}
              onClick={async () => {
                setLoggingOut(true);
                setError('');
                try {
                  await logout();
                  setEditing(false);
                  setConfirmLogout(false);
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setLoggingOut(false);
                }
              }}
            >
              {loggingOut ? '正在退出…' : '确认退出登录'}
            </button>
          </div>
        </Modal>
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
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!nickname.trim()) {
      setError('请输入昵称，不能只包含空格。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await api<{ user: User }>('/users/me', {
        method: 'PATCH',
        body: { nickname, avatarId, removeAvatar },
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
    <Modal
      className="profile-dialog"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
      aria-labelledby="profile-title"
    >
      <form onSubmit={save}>
        <div className="panel-heading">
          <h2 id="profile-title">个人资料与头像</h2>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={onClose}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <label>
          昵称
          <input
            value={nickname}
            name="nickname"
            autoComplete="nickname"
            disabled={busy}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={20}
            required
          />
        </label>
        <AvatarPicker
          value={removeAvatar || !user.avatarUrl ? avatarId : ''}
          onChange={(value) => {
            setAvatarId(value);
            setRemoveAvatar(true);
          }}
        />
        <p className="muted">
          默认头像在保存修改后生效。3D 形象可在
          <Link to="/space" onClick={onClose}>
            个人空间
          </Link>
          单独设置。
        </p>
        {error ? <Notice>{error}</Notice> : null}
        <button className="button primary full" disabled={busy}>
          {busy ? '保存中…' : '保存修改'}
        </button>
      </form>
      <AvatarUpload
        user={user}
        onSave={(updated) => {
          onSave(updated);
          setRemoveAvatar(false);
        }}
      />
    </Modal>
  );
}
export function RhythmFields({
  focus,
  rest,
  setFocus,
  setRest,
  rounds,
  setRounds,
  disabled = false,
}: {
  focus: number;
  rest: number;
  setFocus: (n: number) => void;
  setRest: (n: number) => void;
  rounds: number | null;
  setRounds: (n: number | null) => void;
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
        <label>
          专注轮数
          <select
            value={rounds === null ? 'infinite' : String(rounds)}
            onChange={(event) =>
              setRounds(event.target.value === 'infinite' ? null : Number(event.target.value))
            }
          >
            {[1, 2, 3, 4, 6, 8, 12].map((value) => (
              <option value={value} key={value}>
                {value} 轮
              </option>
            ))}
            <option value="infinite">无限轮 · 手动结束</option>
          </select>
        </label>
      </div>
    </fieldset>
  );
}
