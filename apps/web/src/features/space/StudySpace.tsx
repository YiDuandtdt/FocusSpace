import { memo, useEffect, useRef, useState } from 'react';
import { Avatar } from '../../components';
import { memberLabels, memberSymbols, SEATS } from './memberPresentation';
import type { SceneState, StudyRoomScene } from './StudyRoomScene';

import { readPreferences, savePreferences } from '../../preferences';

export const StudySpace = memo(function StudySpace(props: SceneState) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<StudyRoomScene | null>(null);
  const latest = useRef(props);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [cards, setCards] = useState(() => readPreferences(props.userId ?? '').cards);
  const [preferenceError, setPreferenceError] = useState('');
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
    if (cards) return;
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
  }, [cards, attempt]);

  const fallback = cards || failed || !loaded;
  return (
    <div className={`study-space ${fallback ? 'show-cards' : ''}`}>
      {preferenceError ? <p role="status">{preferenceError}</p> : null}
      <div className="space-view-controls">
        <div>
          <span className="eyebrow">THE READING ROOM</span>
          <strong>窗边自习室</strong>
        </div>
        <button
          className="text-button"
          onClick={() => {
            setCards(!cards);
            if (!savePreferences(props.userId ?? '', { cards: !cards }))
              setPreferenceError('视图已切换，但浏览器未允许保存偏好。');
          }}
          aria-pressed={cards}
        >
          {cards ? '打开 3D 空间' : '使用座位卡片'}
        </button>
      </div>
      {failed && !cards ? (
        <div className="space-fallback-notice" role="status">
          <span>3D 空间暂不可用，已显示座位卡片。计时、任务和聊天仍可使用。</span>
          <button className="text-button" onClick={() => setAttempt((value) => value + 1)}>
            重试 3D
          </button>
        </div>
      ) : null}
      {!cards && !failed && !loaded ? (
        <p className="space-loading" role="status">
          正在打开窗边自习室…
        </p>
      ) : null}
      <div
        ref={host}
        className="scene-host"
        aria-label="窗边自习室成员座位"
        role="group"
        hidden={fallback}
      />
      {fallback ? (
        <div className="seat-cards" aria-label="成员座位卡片">
          {SEATS.map(({ index }) => {
            const member = props.members.find((item) => item.seatIndex === index);
            return (
              <div
                className={`seat-card ${member?.userId === props.userId ? 'is-me' : ''}`}
                key={index}
                data-seat={index}
                data-user-id={member?.userId ?? ''}
                data-status={member?.status ?? 'EMPTY'}
              >
                <span className="seat-number">座位 {String(index + 1).padStart(2, '0')}</span>
                {member ? (
                  <Avatar small nickname={member.nickname} avatarId={member.avatarId} />
                ) : (
                  <span className="empty-seat-icon" aria-hidden="true">
                    ＋
                  </span>
                )}
                <strong>
                  {member
                    ? `${member.nickname}${member.userId === props.userId ? ' · 你' : ''}`
                    : '等你入座'}
                </strong>
                <small>
                  {member
                    ? `${memberSymbols[member.status]} ${memberLabels[member.status]}`
                    : '空座'}
                </small>
              </div>
            );
          })}
        </div>
      ) : null}
      <p className="space-footnote">
        {props.phase === 'BREAK'
          ? '放下笔，伸个懒腰。休息聊天室已开放。'
          : props.phase === 'FOCUS'
            ? '灯下各自努力，也有彼此陪伴。'
            : props.phase === 'ENDED'
              ? '这张桌子，记得今天的努力。'
              : '选一个小目标，和同桌一起开始。'}
      </p>
    </div>
  );
});
