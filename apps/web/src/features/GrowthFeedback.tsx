import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { levelFloor, type GrowthView, type RewardSummary } from '@focusspace/shared';
import { api, errorMessage } from '../api';

export function GrowthEntry() {
  const [data, setData] = useState<GrowthView | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    void api<GrowthView>('/users/me/growth')
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <section className="growth-entry">
      <div>
        <span className="eyebrow">每一段专注，都有回响</span>
        <h2>{data ? `Lv.${data.level} · ${data.coins} 学习币` : '学习成长与装扮'}</h2>
        <p>
          {error ||
            (data
              ? `累计 ${data.xp} 经验 · 下一等级还需 ${data.next - data.xp} 经验。`
              : '正在读取成长记录…')}
        </p>
        {data?.ledger[0] ? (
          <small>
            最近：{data.ledger[0].reason}（{data.ledger[0].coins >= 0 ? '+' : ''}
            {data.ledger[0].coins} 币）
          </small>
        ) : (
          <small>下一个小目标：专注 5 分钟，兑换「陶红开衫」或「一束小花」。</small>
        )}
      </div>
      <Link className="button primary" to="/growth">
        成长与装扮 →
      </Link>
    </section>
  );
}
export function RewardFeedback({ reward }: { reward?: RewardSummary }) {
  if (!reward) return null;
  if (reward.status === 'DEMO' || reward.status === 'LEGACY')
    return (
      <p className="muted">
        {reward.status === 'DEMO'
          ? '演示学习不发放正式经验与学习币。'
          : '升级前的学习记录保留，不追溯发放奖励。'}
      </p>
    );
  if (reward.status === 'PENDING')
    return (
      <aside className="growth-entry">
        <p role="status">奖励处理中，学习记录已保存。重新读取结果或打开成长页会幂等补发。</p>
        <Link to="/growth">查看到账状态 →</Link>
      </aside>
    );
  return (
    <aside className="reward-feedback">
      <span className="eyebrow">本次奖励 · 已到账</span>
      <h3>
        +{reward.xp} 经验 <span>+{reward.coins} 学习币</span>
      </h3>
      <p>
        Lv.{reward.levelAfter} · 结算时累计 {reward.totalXp} 经验
      </p>
      <progress
        aria-label="结算时等级进度"
        value={reward.totalXp - levelFloor(reward.levelAfter)}
        max={levelFloor(reward.levelAfter + 1) - levelFloor(reward.levelAfter)}
      />
      {reward.newUnlocks.length ? (
        <p>新开放：{reward.newUnlocks.join('、')}。等级条件满足后，仍需领取或兑换才会拥有。</p>
      ) : null}
      <Link to="/growth" className="text-button">
        看看这次专注能换什么 →
      </Link>
    </aside>
  );
}
