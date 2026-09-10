import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { RoomCommand, RoomSnapshot } from '@focusspace/shared';
import { useAuth } from '../auth';
import { errorMessage } from '../api';
import { copyText } from '../clipboard';
import { Avatar, Modal, Notice, RhythmFields } from '../components';
import { useRoom } from '../state/useRoom';
import { PhaseTimer, TaskPanel, ChatPanel, SummaryPanel } from '../features/SessionPanels';
import { StudySpace } from '../features/space/StudySpace';
import { Encouragement } from '../features/Encouragement';
import { OwnerControls } from '../features/OwnerControls';
import { AmbientAudio } from '../features/audio/AmbientAudio';
import { memberLabels as stateLabels } from '../features/space/memberPresentation';
import { ROOM_THEMES } from '@focusspace/shared';
import { themes } from '../features/space/themes';
import { useImmersion } from '../features/space/useImmersion';

export function RoomPage() {
  const { roomId = '' } = useParams();
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const { data, status, error, removed, command, messages, lights, serverNow, syncNow } = useRoom(
    roomId,
    user!.id,
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [copied, setCopied] = useState(false);
  const [success, setSuccess] = useState('');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const immersion = useImmersion(user!.id, removed || data?.session.phase === 'ENDED');
  const [showChat, setShowChat] = useState(false);
  useEffect(() => {
    setShowChat(data?.session.phase === 'BREAK');
  }, [data?.session.phase]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  async function perform(type: RoomCommand, payload: unknown = {}) {
    if (busy) return false;
    setBusy(true);
    setActionError('');
    setSuccess('');
    try {
      await command(type, payload);
      if (type === 'session:end') await refresh();
      if (
        type === 'member:leave' ||
        (type === 'room:transfer' && (payload as { leave?: boolean }).leave)
      ) {
        await refresh();
        navigate('/');
      }
      return true;
    } catch (e) {
      setActionError(errorMessage(e));
      return false;
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
            <button className="button primary" onClick={syncNow}>
              重试连接
            </button>
          ) : null}
        </div>
      </section>
    );
  const me = data.members.find((m) => m.userId === user?.id);
  const ended = data.session.phase === 'ENDED';
  const lobby = data.session.phase === 'LOBBY';
  const phaseLabel = { LOBBY: '房间大厅', FOCUS: '正在专注', BREAK: '休息时间', ENDED: '共学结果' }[
    data.session.phase
  ];
  const writable = status === 'online' && !busy && !ended;
  const online = data.members.filter((m) => m.connectionState === 'CONNECTED').length;
  return (
    <div
      ref={immersion.root}
      data-theme={data.room.theme}
      className={`room-page phase-${data.session.phase} ${immersion.active ? 'focus-view' : ''} ${showChat ? 'show-focus-chat' : ''}`}
    >
      <div className="room-breadcrumb">
        <Link to="/">我的空间</Link>
        <span>/</span>
        <span>{phaseLabel}</span>
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
          {error || '连接中断，正在恢复。座位在宽限期内保留，恢复连接后可以继续操作。'}
          <button className="text-button" onClick={syncNow}>
            重试连接
          </button>
        </div>
      ) : null}
      <div className="room-heading">
        <div>
          <span className="eyebrow">{ended ? 'ROOM CLOSED' : 'SETTLE IN, TOGETHER'}</span>
          <h1>{data.room.name}</h1>
          <p>
            {ended
              ? '把今天的推进留在这里，下次继续。'
              : lobby
                ? '先写下目标，等学习搭子到齐。'
                : data.session.phase === 'FOCUS'
                  ? '留一点安静，给正在努力的自己。'
                  : '这一轮辛苦了，放松一下。'}
          </p>
        </div>
        <div className="room-invite-actions">
          <button
            className="invite-code"
            onClick={() => {
              setActionError('');
              setSuccess('');
              setCopied(false);
              void copyText(data.room.code)
                .then(() => {
                  setCopied(true);
                  setSuccess('房间码已复制，分享给朋友一起入座。');
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
          {!ended ? (
            <button
              className="text-button invitation-link"
              onClick={() =>
                void copyText(window.location.origin + '/join/' + data.room.code)
                  .then(() => {
                    setActionError('');
                    setSuccess('邀请链接已复制');
                  })
                  .catch(() =>
                    setActionError(
                      '请复制邀请链接：' + window.location.origin + '/join/' + data.room.code,
                    ),
                  )
              }
            >
              复制邀请链接 ↗
            </button>
          ) : null}
        </div>
      </div>
      {actionError ? <Notice>{actionError}</Notice> : null}
      {success ? <Notice tone="success">{success}</Notice> : null}
      {data.summary ? <SummaryPanel summary={data.summary} /> : null}
      {!ended ? (
        <div className="immersion-toolbar" aria-label="空间体验控制">
          <span className="theme-badge">{themes[data.room.theme].name}</span>
          <button
            className="button secondary"
            aria-pressed={immersion.active}
            onClick={immersion.toggleFocus}
          >
            {immersion.active ? '返回完整界面' : '专注视图'}
          </button>
          <button
            className="text-button fullscreen-control"
            onClick={() => void immersion.toggleFullscreen()}
          >
            {immersion.fullscreen ? '退出全屏' : '全屏专注'}
          </button>
          {immersion.active ? (
            <button
              className="text-button"
              aria-expanded={showChat}
              aria-controls="room-chat"
              onClick={() => setShowChat(!showChat)}
            >
              {showChat
                ? '收起聊天'
                : data.session.phase === 'BREAK'
                  ? '打开休息聊天'
                  : '聊天 · 休息时开放'}
            </button>
          ) : null}
          <button
            className="text-button toolbar-leave"
            disabled={!writable}
            onClick={() => setConfirmLeave(true)}
          >
            {data.myPermissions.isOwner ? '结束共学' : '离开房间'}
          </button>
        </div>
      ) : null}
      {immersion.notice ? (
        <p className="immersion-notice" role="status">
          {immersion.notice}
        </p>
      ) : null}
      {lobby && !data.room.spaceSnapshot ? (
        <section className="theme-picker" aria-label="房间主题">
          <div className="panel-heading">
            <h2>选一处，安静坐下</h2>
            <small>
              {data.myPermissions.isOwner
                ? '开始后固定 · 不改变个人声音'
                : '由房主选择 · 所有成员同步'}
            </small>
          </div>
          <div className="theme-options">
            {ROOM_THEMES.map((theme) => (
              <button
                key={theme}
                data-theme={theme}
                aria-pressed={data.room.theme === theme}
                disabled={!writable || !data.myPermissions.canConfigure}
                onClick={() => void perform('room:theme', { theme })}
              >
                <span className="theme-window" aria-hidden="true">
                  <i />
                  <i />
                </span>
                <strong>
                  {themes[theme].name}
                  {data.room.theme === theme ? ' ✓' : ''}
                </strong>
                <small>{themes[theme].description}</small>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <nav className="room-shortcuts" aria-label="房间快捷入口">
        <a href="#room-space">空间与计时</a>
        <a href="#room-tasks">我的任务</a>
        <a href="#room-chat" onClick={() => setShowChat(true)}>
          {data.session.phase === 'BREAK' ? '聊天 · 已开放' : '休息聊天'}
        </a>
        {!ended ? <a href="#room-audio">声音</a> : null}
      </nav>
      <div className="room-grid">
        <div className="room-main">
          <section className="space-panel" id="room-space">
            <div className="space-top">
              <span>
                <i className="status-dot" />
                {phaseLabel}
              </span>
              <span>
                {online} 人在线 / {data.room.capacity} 个座位
              </span>
            </div>
            {!lobby && !ended ? (
              <PhaseTimer
                key={`${roomId}-${data.session.phaseEndAt}`}
                session={data.session}
                serverNow={serverNow}
                syncNow={syncNow}
              />
            ) : null}
            <StudySpace
              key={roomId}
              members={data.members}
              phase={data.session.phase}
              userId={user?.id}
              theme={data.room.theme}
              space={data.room.spaceSnapshot?.config}
              seed={data.room.spaceSnapshot?.seed}
              canSelectSeat={lobby && writable}
              onSeatSelect={(seatIndex) => void perform('member:seat', { seatIndex })}
              completedUsers={lights
                .filter((light) => light.symbol === '✓')
                .map((light) => light.userId)}
            />
            <div className="light-feedback" aria-live="off">
              {lights.map((light) => (
                <span key={light.eventId} className="light-symbol">
                  {light.symbol} {data.members.find((m) => m.userId === light.userId)?.nickname}
                  {light.symbol === '✓' ? ' 完成了一个任务' : ''}
                </span>
              ))}
            </div>
            {!lobby && !ended ? <Encouragement disabled={!writable} command={command} /> : null}
            {!ended ? (
              <AmbientAudio
                key={`audio-${roomId}`}
                recommended={data.room.spaceSnapshot?.config.sound ?? themes[data.room.theme].sound}
              />
            ) : null}
            {!ended ? (
              <div className="lobby-controls">
                <div>
                  <strong>
                    {me?.afk
                      ? '稍作离开，也没关系'
                      : lobby
                        ? me?.ready
                          ? '你已准备好'
                          : '安顿好，就准备一下'
                        : phaseLabel}
                  </strong>
                  <p>
                    {lobby
                      ? '所有成员在线、非暂离且准备后，房主可以开始。'
                      : me?.lateJoin
                        ? '你是中途加入，已立即同步当前阶段，从入座连接后开始个人计时。'
                        : '暂离时暂停个人计时，房间节奏继续。'}
                  </p>
                </div>
                <div>
                  <button
                    className="button secondary"
                    aria-pressed={!!me?.afk}
                    disabled={!writable}
                    onClick={() => void perform('member:afk', { afk: !me?.afk })}
                  >
                    {me?.afk ? '我回来了' : '暂时离开'}
                  </button>
                  {lobby ? (
                    <button
                      className="button primary"
                      aria-pressed={!!me?.ready}
                      disabled={!writable || me?.afk}
                      onClick={() => void perform('member:ready', { ready: !me?.ready })}
                    >
                      {me?.ready ? '取消准备' : '我准备好了'} <span aria-hidden="true">✓</span>
                    </button>
                  ) : null}
                  {lobby && data.myPermissions.isOwner ? (
                    <button
                      className="button primary"
                      disabled={!writable || !data.myPermissions.canStart}
                      onClick={() => void perform('session:start')}
                    >
                      开始共学
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>
        </div>
        <aside className="room-sidebar">
          <div id="room-tasks">
            <TaskPanel
              key={user!.id + roomId}
              roomId={roomId}
              tasks={data.myTasks}
              disabled={!writable}
              ended={ended}
              command={command}
            />
          </div>
          <div id="room-chat" className="focus-chat">
            <ChatPanel
              key={user!.id + roomId}
              data={data}
              messages={messages}
              disabled={!writable}
              command={command}
            />
          </div>
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
                  <Avatar
                    small
                    nickname={member.nickname}
                    avatarId={member.avatarId}
                    avatarUrl={member.avatarUrl}
                  />
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
                    <span>
                      {member.lateJoin ? '中途加入 · ' : ''}
                      {member.tasksTotal
                        ? `${member.tasksDone} / ${member.tasksTotal} · ${member.progressPercent}%`
                        : '未设置任务'}
                    </span>
                  </div>
                  {status === 'online' && member.publicTasks.length ? (
                    <div className="public-tasks">
                      {member.publicTasks.map((task) => (
                        <span className="public-task" key={task.id}>
                          {task.completed ? '✓' : '○'} {task.title}
                        </span>
                      ))}
                    </div>
                  ) : null}
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
          <OwnerControls data={data} disabled={!writable} perform={perform} />
          <RhythmPanel
            key={`${data.session.focusSeconds}-${data.session.breakSeconds}`}
            data={data}
            disabled={!writable}
            onSave={(payload) => perform('room:configure', payload)}
          />
          <p className="phase-note">
            {lobby
              ? '准备好后，房主开始共享专注。'
              : ended
                ? '本次结果已保存，继续共学请新建房间。'
                : '共享节奏由房间统一推进，刷新后恢复当前轮次。'}
          </p>
        </aside>
      </div>
      {confirmLeave ? (
        <Modal
          className="profile-dialog"
          onCancel={() => setConfirmLeave(false)}
          aria-labelledby="leave-title"
        >
          <h2 id="leave-title">
            {data.myPermissions.isOwner ? '结束这个房间？' : '离开这个房间？'}
          </h2>
          <p className="muted">
            {data.myPermissions.isOwner
              ? '这会结束所有人的共学并结算全房。如仅自己离开，请取消，返回完整界面使用“转交后自己离开”。'
              : '你的座位会被释放，之后可以用房间码重新加入。已记录的有效学习会保留，在这场共学最终结束后统一结算经验与学习币。'}
          </p>
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setConfirmLeave(false)}>
              继续留在这里
            </button>
            <button
              className="button danger"
              disabled={!writable}
              onClick={() => {
                setConfirmLeave(false);
                void perform(data.myPermissions.isOwner ? 'session:end' : 'member:leave');
              }}
            >
              {data.myPermissions.isOwner ? '确认结束' : '确认离开'}
            </button>
          </div>
        </Modal>
      ) : null}
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
  onSave: (payload: {
    focusSeconds: number;
    breakSeconds: number;
    targetRounds: number | null;
  }) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [focus, setFocus] = useState(data.session.focusSeconds / 60);
  const [rest, setRest] = useState(data.session.breakSeconds / 60);
  const [rounds, setRounds] = useState<number | null>(data.session.targetRounds);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (
      await onSave({
        focusSeconds: focus * 60,
        breakSeconds: rest * 60,
        targetRounds: rounds,
      })
    )
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
      {data.demoAvailable && data.myPermissions.canConfigure ? (
        <button
          className="text-button"
          disabled={disabled}
          onClick={() => void onSave({ focusSeconds: 45, breakSeconds: 15, targetRounds: 1 })}
        >
          使用 45/15 秒演示节奏
        </button>
      ) : null}
      {editing && data.myPermissions.canConfigure ? (
        <form onSubmit={save}>
          <RhythmFields
            focus={focus}
            rest={rest}
            rounds={rounds}
            setFocus={setFocus}
            setRest={setRest}
            setRounds={setRounds}
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
              <strong>{data.session.demoMode ? 45 : data.session.focusSeconds / 60}</strong>
              <span>{data.session.demoMode ? '秒专注 · 演示' : '分钟专注'}</span>
            </div>
            <span className="rhythm-slash">/</span>
            <div>
              <strong>{data.session.demoMode ? 15 : data.session.breakSeconds / 60}</strong>
              <span>{data.session.demoMode ? '秒休息 · 演示' : '分钟休息'}</span>
            </div>
          </div>
          <p className="rhythm-rounds">
            {data.session.targetRounds === null
              ? `第 ${Math.max(1, data.session.roundNo)} 轮 · 无限循环`
              : `${data.session.roundNo || 0} / ${data.session.targetRounds} 轮`}
          </p>
          <p className="muted">先约定节奏，再一起开始。</p>
        </>
      )}
    </section>
  );
}
