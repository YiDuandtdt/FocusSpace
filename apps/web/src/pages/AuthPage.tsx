import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import type { User } from '@focusspace/shared';
import { useAuth } from '../auth';
import { api, errorMessage } from '../api';
import { AvatarPicker, Notice } from '../components';

export function AuthPage({ register = false }: { register?: boolean }) {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get('next');
  const next =
    returnTo &&
    /^\/(?:space|history|admin(?:\/[a-z]+)?|join\/[A-HJ-NP-Z2-9]{6}|rooms\/[^/?#\\]+|sessions\/[^/?#\\]+\/summary)?(?:\?[^#\\]*)?$/.test(
      returnTo,
    )
      ? returnTo
      : '/';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [avatarId, setAvatarId] = useState<User['avatarId']>('lake');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  if (user)
    return (
      <Navigate
        to={
          user.onboarding === 'PENDING' ? `/space?setup=1&next=${encodeURIComponent(next)}` : next
        }
        replace
      />
    );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (register && !nickname.trim()) {
      setError('请输入昵称，不能只包含空格。');
      event.currentTarget.querySelector<HTMLInputElement>('[name="nickname"]')?.focus();
      return;
    }
    setError('');
    setBusy(true);
    try {
      if (register) {
        await api('/auth/register', {
          method: 'POST',
          body: { username, password, nickname, avatarId },
        });
        await api('/auth/login', { method: 'POST', body: { username, password } });
        await refresh();
        navigate(`/space?setup=1&next=${encodeURIComponent(next)}`);
      } else {
        const result = await api<{ user: User }>('/auth/login', {
          method: 'POST',
          body: { username, password },
        });
        await refresh();
        navigate(
          result.user.onboarding === 'PENDING'
            ? `/space?setup=1&next=${encodeURIComponent(next)}`
            : next,
        );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-layout">
      <div className="auth-story">
        <span className="eyebrow">A PLACE TO FOCUS</span>
        <h1>
          一个人的目标，
          <br />
          <em>一起向前。</em>
        </h1>
        <p>
          找个位置，和朋友一起坐下。
          <br />
          让安静的陪伴，成为开始的理由。
        </p>
        <div className="window-art" aria-hidden="true">
          <div className="window-frame">
            <div className="window-hill hill-back" />
            <div className="window-hill hill-front" />
            <div className="window-mullion" />
          </div>
          <div className="window-sill" />
          <div className="plant">
            <i />
            <i />
            <i />
            <b />
          </div>
          <div className="book book-one" />
          <div className="book book-two" />
        </div>
        <span className="story-caption">同一个空间，各自的热爱。</span>
      </div>
      <div className="auth-card">
        <span className="eyebrow">{register ? 'YOUR FIRST SEAT' : 'WELCOME BACK'}</span>
        <h2>{register ? '认识一下，学习搭子' : '欢迎回来'}</h2>
        <p className="muted">
          {register ? '创建账号，给自己留一个专注的位置。' : '你的下一段专注，从这里开始。'}
        </p>
        {!register && params.has('registered') ? (
          <p className="success" role="status">
            注册成功，请使用新账号登录。
          </p>
        ) : null}
        <form onSubmit={submit}>
          <label>
            账号
            <input
              autoComplete="username"
              name="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="3–24 位字母、数字或下划线"
              minLength={3}
              maxLength={24}
              required
              pattern="[A-Za-z0-9_]+"
            />
          </label>
          {register ? (
            <label>
              昵称
              <input
                autoComplete="nickname"
                name="nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="大家怎么称呼你？"
                maxLength={20}
                required
              />
            </label>
          ) : null}
          <label htmlFor="auth-password">密码</label>
          <div className="password-field">
            <input
              id="auth-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete={register ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 位字符"
              minLength={8}
              maxLength={72}
              required
            />
            <button
              type="button"
              className="text-button"
              aria-controls="auth-password"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? '隐藏密码' : '显示密码'}
            </button>
          </div>
          {register ? <AvatarPicker value={avatarId} onChange={setAvatarId} /> : null}
          {error ? <Notice>{error}</Notice> : null}
          <button className="button primary full" disabled={busy}>
            {busy ? '请稍候…' : register ? '创建账号' : '登录 FocusSpace'}
            <span aria-hidden="true">↗</span>
          </button>
        </form>
        <p className="auth-switch">
          {register ? '已经有账号？' : '第一次来到这里？'}{' '}
          <Link to={`${register ? '/login' : '/register'}?next=${encodeURIComponent(next)}`}>
            {register ? '去登录' : '注册账号'}
          </Link>
        </p>
      </div>
    </section>
  );
}
