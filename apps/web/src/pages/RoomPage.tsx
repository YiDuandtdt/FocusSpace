import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Member, RoomCommand, RoomSnapshot } from '@focusspace/shared';
import { useAuth } from '../auth';
import { errorMessage } from '../api';
import { Avatar, Notice, RhythmFields } from '../components';
import { useRoom } from '../state/useRoom';

const stateLabels = {
  JOINED: '已入座',
  READY: '已准备',
  AFK: '暂时离开',
  DISCONNECTED: '等待重连',
};
export function RoomPage() {
  const { roomId = '' } = useParams();
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const { data, status, error, removed, command } = useRoom(roomId);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  async function perform(type: RoomCommand, payload: unknown = {}) {
    setBusy(true);
    setActionError('');
    try {
      await command(type, payload);
      if (type === 'member:leave') {
        await refresh();
        navigate('/');
      }
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (removed)
    return (
      <section className="empty-state">
        <span className="eyebrow">ROOM UNAVAILABLE</span>
        <h1>这个座位已暂时离开</h1>
        <p>{error}</p>
        <Link className="button primary" to="/">
          返回首页
        </Link>
      </section>
    );
  if (!data)
    return (
      <section className="empty-state">
        <h2>{error ? '暂时无法打开房间' : '正在为你打开房间…'}</h2>
        {error ? <Notice>{error}</Notice> : <p>正在恢复房间和成员信息。</p>}
        <div className="empty-actions">
          <Link className="button secondary" to="/">
            返回首页
          </Link>
          {error ? (
            <button className="button primary" onClick={() => window.location.reload()}>
              重试连接
            </button>
          ) : null}
        </div>
      </section>
    );
  const me = data.members.find((m) => m.userId === user?.id);
  const ended = data.session.phase === 'ENDED';
  const writable = status === 'online' && !busy && !ended;
  const online = data.members.filter((m) => m.connectionState === 'CONNECTED').length;
  return (
    <div className="room-page">
      <div className="room-breadcrumb">
        <Link to="/">我的空间</Link>
        <span>/</span>
        <span>房间大厅</span>
        <span className={`connection ${status}`} role="status">
          <i />
          {status === 'online'
            ? '实时连接正常'
            : status === 'connecting'
              ? '连接中'
              : '连接中断 · 正在恢复'}
        </span>
      </div>
      {status !== 'online' ? (
        <div className="connection-banner" role="status">
          {error || '连接中断，成员位置暂时保留 60 秒。恢复连接后可以继续操作。'}
        </div>
      ) : null}
      <div className="room-heading">
        <div>
          <span className="eyebrow">{ended ? 'ROOM CLOSED' : 'SETTLE IN, TOGETHER'}</span>
          <h1>{data.room.name}</h1>
          <p>{ended ? '房主已离开或断线超时，这个房间已经结束。' : '先坐下来，等学习搭子到齐。'}</p>
        </div>
        <button
          className="invite-code"
          onClick={() => {
            void navigator.clipboard
              .writeText(data.room.code)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              })
              .catch(() => setActionError(`复制未成功，请手动复制房间码：${data.room.code}`));
          }}
        >
          <span>{copied ? '已复制房间码' : '房间码 · 点击复制'}</span>
          <strong>{data.room.code}</strong>
          <small>
            {ended ? '房间已关闭' : '分享给朋友，一起入座'} <span aria-hidden="true">↗</span>
          </small>
        </button>
      </div>
      {actionError ? <Notice>{actionError}</Notice> : null}
      {ended ? (
        <div className="ended-banner">
          <div>
            <strong>这次相聚先到这里</strong>
            <p>当前阶段尚未开始计时，不生成学习记录。新建房间即可再次邀请朋友。</p>
          </div>
          <Link className="button primary" to="/">
            回到首页 ↗
          </Link>
        </div>
      ) : null}
      <div className="room-grid">
        <section className="space-panel">
          <div className="space-top">
            <span>
              <i className="status-dot" />
              {ended ? '已结束' : '房间大厅'}
            </span>
            <span>
              {online} 人在线 / {data.room.capacity} 个座位
            </span>
          </div>
          <div className="seating-room">
            <div className="room-window" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="seats seats-top">
              {[0, 1, 2, 3].map((i) => (
                <Seat
                  key={i}
                  index={i}
                  member={data.members.find((m) => m.seatIndex === i)}
                  userId={user?.id}
                />
              ))}
            </div>
            <div className="study-table">
              <span className="table-book" aria-hidden="true" />
              <div>
                <span className="eyebrow">SHARED SPACE</span>
                <strong>各自学习，一起专注</strong>
                <span>给今天的目标，留一个位置。</span>
              </div>
              <span className="table-plant" aria-hidden="true">
                ✳
              </span>
            </div>
            <div className="seats seats-bottom">
              {[4, 5, 6, 7].map((i) => (
                <Seat
                  key={i}
                  index={i}
                  member={data.members.find((m) => m.seatIndex === i)}
                  userId={user?.id}
                />
              ))}
            </div>
          </div>
          <div className="space-caption">
            <span>房间仅通过房间码加入</span>
            <span>成员变化实时同步</span>
          </div>
          <div className="lobby-controls">
            <div>
              <strong>
                {me?.afk ? '稍作离开，也没关系' : me?.ready ? '你已准备好' : '安顿好，就准备一下'}
              </strong>
              <p>准备状态对房间内的所有人可见。</p>
            </div>
            <div>
              <button
                className="button secondary"
                disabled={!writable}
                onClick={() => void perform('member:afk', { afk: !me?.afk })}
              >
                {me?.afk ? '我回来了' : '暂时离开'}
              </button>
              <button
                className="button primary"
                disabled={!writable || me?.afk}
                onClick={() => void perform('member:ready', { ready: !me?.ready })}
              >
                {me?.ready ? '取消准备' : '我准备好了'} <span aria-hidden="true">✓</span>
              </button>
            </div>
          </div>
        </section>
        <aside className="room-sidebar">
          <section className="panel members-panel">
            <div className="panel-heading">
              <h2>一起学习的人</h2>
              <span className="member-count">
                {data.members.length}/{data.room.capacity}
              </span>
            </div>
            <ul className="member-list">
              {data.members.map((member) => (
                <li key={member.userId}>
                  <Avatar small nickname={member.nickname} avatarId={member.avatarId} />
                  <div>
                    <strong>
                      {member.nickname}
                      {member.userId === user?.id ? <small>（你）</small> : null}
                    </strong>
                    <span>
                      {member.isOwner
                        ? '房主'
                        : `座位 ${String(member.seatIndex + 1).padStart(2, '0')}`}
                    </span>
                  </div>
                  <span className={`member-state state-${member.status}`}>
                    {stateLabels[member.status]}
                  </span>
                </li>
              ))}
            </ul>
            {data.members.length === 1 && !ended ? (
              <p className="member-empty">复制房间码，邀请第一位学习搭子。</p>
            ) : null}
          </section>
          <RhythmPanel
            key={`${data.session.focusSeconds}-${data.session.breakSeconds}`}
            data={data}
            disabled={!writable}
            onSave={(payload) => perform('room:configure', payload)}
          />
          <p className="phase-note">
            当前开放房间大厅与成员同步。
            <br />
            共享计时、任务和聊天将在后续开放。
          </p>
          <button
            className="text-button leave-button"
            disabled={!writable}
            onClick={() => setConfirmLeave(true)}
          >
            {data.myPermissions.isOwner ? '结束并离开房间' : '离开房间'}{' '}
            <span aria-hidden="true">↗</span>
          </button>
        </aside>
      </div>
      {confirmLeave ? (
        <dialog
          className="profile-dialog"
          ref={(node) => {
            if (node && !node.open) node.showModal();
          }}
          onCancel={() => setConfirmLeave(false)}
          aria-labelledby="leave-title"
        >
          <h2 id="leave-title">
            {data.myPermissions.isOwner ? '结束这个房间？' : '离开这个房间？'}
          </h2>
          <p className="muted">
            {data.myPermissions.isOwner
              ? '你是房主，离开后房间将对所有成员结束。'
              : '你的座位会被释放，之后可以用房间码重新加入。'}
          </p>
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setConfirmLeave(false)}>
              继续留在这里
            </button>
            <button
              className="button primary"
              disabled={!writable}
              onClick={() => {
                setConfirmLeave(false);
                void perform('member:leave');
              }}
            >
              确认离开
            </button>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
function Seat({ index, member, userId }: { index: number; member?: Member; userId?: string }) {
  return (
    <div
      className={`seat ${member ? 'occupied' : 'vacant'} ${member?.status === 'DISCONNECTED' || member?.afk ? 'away' : ''}`}
    >
      <div className="seat-shape">
        {member ? (
          <Avatar nickname={member.nickname} avatarId={member.avatarId} />
        ) : (
          <span aria-hidden="true">＋</span>
        )}
        {member?.ready ? (
          <span className="seat-ready" aria-label="已准备">
            ✓
          </span>
        ) : null}
      </div>
      <strong>
        {member ? `${member.nickname}${member.userId === userId ? ' · 你' : ''}` : '等你入座'}
      </strong>
      <small>
        {member ? stateLabels[member.status] : `SEAT ${String(index + 1).padStart(2, '0')}`}
      </small>
    </div>
  );
}
function RhythmPanel({
  data,
  disabled,
  onSave,
}: {
  data: RoomSnapshot;
  disabled: boolean;
  onSave: (payload: { focusSeconds: number; breakSeconds: number }) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [focus, setFocus] = useState(data.session.focusSeconds / 60);
  const [rest, setRest] = useState(data.session.breakSeconds / 60);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    await onSave({ focusSeconds: focus * 60, breakSeconds: rest * 60 });
    setEditing(false);
  };
  return (
    <section className="panel rhythm-panel">
      <div className="panel-heading">
        <h2>我们的节奏</h2>
        {data.myPermissions.canConfigure ? (
          <button className="text-button" disabled={disabled} onClick={() => setEditing(!editing)}>
            {editing ? '收起' : '修改'}
          </button>
        ) : (
          <span className="muted">房主设置</span>
        )}
      </div>
      {editing ? (
        <form onSubmit={save}>
          <RhythmFields
            focus={focus}
            rest={rest}
            setFocus={setFocus}
            setRest={setRest}
            disabled={disabled}
          />
          <p className="muted">修改后，所有成员需要重新准备。</p>
          <button className="button secondary full" disabled={disabled}>
            保存节奏
          </button>
        </form>
      ) : (
        <>
          <div className="rhythm-display">
            <div>
              <strong>{data.session.focusSeconds / 60}</strong>
              <span>分钟专注</span>
            </div>
            <span className="rhythm-slash">/</span>
            <div>
              <strong>{data.session.breakSeconds / 60}</strong>
              <span>分钟休息</span>
            </div>
          </div>
          <p className="muted">先约定节奏，再一起开始。</p>
        </>
      )}
    </section>
  );
}
