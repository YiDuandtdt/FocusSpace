import { memo, useEffect, useRef, useState } from 'react';
import { Avatar } from '../../components';
import { memberLabels, memberSymbols, SEATS } from './memberPresentation';
import type { SceneState, StudyRoomScene } from './StudyRoomScene';

import { themes } from './themes';

export const StudySpace = memo(function StudySpace(props: SceneState) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<StudyRoomScene | null>(null);
  const latest = useRef(props);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    latest.current = props;
    try {
      scene.current?.update(props);
    } catch {
      scene.current?.dispose();
      scene.current = null;
      setFailed(true);
    }
  }, [props]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setFailed(false);
    const fail = () => {
      if (cancelled) return;
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
      setFailed(true);
    };
    const timeout = window.setTimeout(fail, 15000);
    void import('./StudyRoomScene')
      .then(({ createStudyRoomScene }) => {
        if (cancelled || !host.current) return;
        scene.current = createStudyRoomScene(host.current, fail);
        scene.current.update(latest.current);
        setLoaded(true);
        clearTimeout(timeout);
      })
      .catch(fail);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      scene.current?.dispose();
      scene.current = null;
    };
  }, [attempt]);

  const fallback = failed;
  return (
    <div className={`study-space ${fallback ? 'show-cards' : ''}`}>
      {failed ? (
        <div className="space-fallback-notice" role="status">
          <span>3D 空间暂不可用，已显示座位卡片。计时、任务和聊天仍可使用。</span>
          <button className="text-button" onClick={() => setAttempt((value) => value + 1)}>
            重试 3D
          </button>
        </div>
      ) : null}
      {!failed && !loaded ? (
        <p className="space-loading" role="status">
          正在打开{themes[props.theme].name}…
        </p>
      ) : null}
      <div
        ref={host}
        className="scene-host"
        aria-label={`${themes[props.theme].name}成员座位`}
        role="group"
        tabIndex={0}
        hidden={failed}
      />
      {fallback ? (
        <div className="seat-cards" aria-label="成员座位卡片">
          {SEATS.map(({ index }) => {
            const member = props.members.find((item) => item.seatIndex === index);
            return (
              <button
                type="button"
                className={`seat-card ${member?.userId === props.userId ? 'is-me' : ''}`}
                key={index}
                data-seat={index}
                data-user-id={member?.userId ?? ''}
                data-status={member?.status ?? 'EMPTY'}
                data-completed={props.completedUsers?.includes(member?.userId ?? '') || undefined}
                aria-label={
                  member
                    ? `${member.nickname}，座位 ${String(index + 1).padStart(2, '0')}`
                    : `选择座位 ${String(index + 1).padStart(2, '0')}`
                }
                disabled={!!member || !props.canSelectSeat}
                onClick={() => props.onSeatSelect?.(index)}
              >
                {member ? (
                  <span className="seat-number">座位 {String(index + 1).padStart(2, '0')}</span>
                ) : null}
                {member ? (
                  <Avatar
                    small
                    nickname={member.nickname}
                    avatarId={member.avatarId}
                    avatarUrl={member.avatarUrl}
                  />
                ) : (
                  <span className="empty-seat-icon" aria-hidden="true">
                    ＋
                  </span>
                )}
                {member ? (
                  <>
                    <strong>{`${member.nickname}${member.userId === props.userId ? ' · 你' : ''}`}</strong>
                    <small>
                      {`${memberSymbols[member.status]} ${memberLabels[member.status]}`}
                      {props.completedUsers?.includes(member.userId) ? ' · ✓ 完成任务' : ''}
                    </small>
                  </>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});
