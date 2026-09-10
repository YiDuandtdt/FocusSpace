import { useEffect, useState } from 'react';
import type { Leaderboards } from '@focusspace/shared';
import { api, errorMessage } from '../api';
import { Avatar, Notice } from '../components';

export function LeaderboardPage() {
  const [kind, setKind] = useState<'focus' | 'level'>('focus');
  const [data, setData] = useState<Leaderboards | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<Leaderboards>('/leaderboards')
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  const entries = data?.[kind] ?? [];
  return (
    <div className="planning-page leaderboard-page">
      <div className="planning-heading">
        <div>
          <span className="eyebrow">GROW TOGETHER</span>
          <h1>排行榜</h1>
          <p>每周一刷新专注时长；等级榜记录长期成长。</p>
        </div>
        <div className="period-tabs">
          <button aria-pressed={kind === 'focus'} onClick={() => setKind('focus')}>
            本周专注
          </button>
          <button aria-pressed={kind === 'level'} onClick={() => setKind('level')}>
            成长等级
          </button>
        </div>
      </div>
      {error ? (
        <Notice>{error}</Notice>
      ) : !data ? (
        <section className="panel" role="status">
          正在读取排行榜…
        </section>
      ) : (
        <section className="leaderboard-card">
          <div className="leaderboard-caption">
            <span>{kind === 'focus' ? '本周有效专注' : '当前成长等级'}</span>
            <time>周期开始于 {new Date(data.weekStart).toLocaleDateString()}</time>
          </div>
          <ol>
            {entries.map((entry) => (
              <li key={entry.userId} className={entry.isMe ? 'is-me' : ''}>
                <span className="rank">
                  {entry.rank <= 3
                    ? ['🥇', '🥈', '🥉'][entry.rank - 1]
                    : String(entry.rank).padStart(2, '0')}
                </span>
                <Avatar
                  nickname={entry.nickname}
                  avatarId={entry.avatarId}
                  avatarUrl={entry.avatarUrl}
                  small
                />
                <div>
                  <strong>
                    {entry.nickname}
                    {entry.isMe ? ' · 你' : ''}
                  </strong>
                  <small>Lv.{entry.level}</small>
                </div>
                <b>
                  {kind === 'focus' ? `${Math.floor(entry.value / 60)} 分` : `Lv.${entry.value}`}
                </b>
              </li>
            ))}
          </ol>
          {!entries.length ? (
            <div className="journal-empty">
              <h2>本周榜单还在等待第一段专注</h2>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
