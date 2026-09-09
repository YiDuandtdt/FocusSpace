import { useState } from 'react';
import type { RoomCommand, RoomSnapshot } from '@focusspace/shared';
export function OwnerControls({
  data,
  disabled,
  perform,
}: {
  data: RoomSnapshot;
  disabled: boolean;
  perform: (type: RoomCommand, payload?: unknown) => Promise<boolean>;
}) {
  const [targetId, setTargetId] = useState('');
  const eligible = data.members.filter(
    (m) => !m.isOwner && !m.afk && m.connectionState === 'CONNECTED',
  );
  if (!data.myPermissions.isOwner || data.session.phase === 'ENDED') return null;
  const transfer = async (leave: boolean) => {
    const target = eligible.find((m) => m.userId === targetId);
    if (!target) return;
    if (
      !window.confirm(
        '将房主交给 ' +
          target.nickname +
          (leave ? ' 并释放自己的座位' : '，自己继续共学') +
          '？当前阶段、任务和统计继续保留。',
      )
    )
      return;
    if (await perform('room:transfer', { targetId, leave })) setTargetId('');
  };
  return (
    <details className="panel owner-controls">
      <summary>房主管理</summary>
      <p>
        当前房间：{data.room.visibility === 'PUBLIC' ? '公开' : '私有'}
        {data.room.delisted ? ' · 已被管理员下架' : ''}
      </p>
      <button
        className="button secondary full"
        disabled={disabled || data.room.delisted}
        onClick={() => {
          const visibility = data.room.visibility === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC';
          if (
            window.confirm(
              visibility === 'PUBLIC'
                ? '公开后主题与节奏会展示在首页，其他用户可加入。确认公开？'
                : '转为私有后停止公开展示和新的公开加入，已有成员继续。确认？',
            )
          )
            void perform('room:visibility', { visibility });
        }}
      >
        {data.room.visibility === 'PUBLIC' ? '转为私有' : '公开这个房间'}
      </button>
      <label>
        接任房主
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={disabled}>
          <option value="">选择在线且非暂离的成员</option>
          {eligible.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.nickname}
            </option>
          ))}
        </select>
      </label>
      <div className="owner-actions">
        <button
          className="button secondary"
          disabled={disabled || !eligible.some((m) => m.userId === targetId)}
          onClick={() => void transfer(false)}
        >
          转交房主
        </button>
        <button
          className="button secondary"
          disabled={disabled || !eligible.some((m) => m.userId === targetId)}
          onClick={() => void transfer(true)}
        >
          转交后自己离开
        </button>
      </div>
      <p className="muted">
        断线宽限期结束后，由最早入座的在线、非暂离成员接任；无人可接任时结束共学。
      </p>
    </details>
  );
}
