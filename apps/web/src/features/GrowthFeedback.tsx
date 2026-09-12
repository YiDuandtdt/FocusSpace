import { levelFloor, type RewardSummary } from '@focusspace/shared';
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
    </aside>
  );
}
