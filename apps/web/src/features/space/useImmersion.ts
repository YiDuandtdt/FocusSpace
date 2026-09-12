import { useEffect, useRef, useState } from 'react';
import { readPreferences, savePreferences } from '../../preferences';

// Presentation state never sends a room command or owns a session timer.
export function useImmersion(userId: string, ended: boolean) {
  const root = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(() => readPreferences(userId).focusView);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState('');
  const active = focus && !ended;
  useEffect(() => {
    document.body.classList.toggle('in-focus-view', active);
    return () => document.body.classList.remove('in-focus-view');
  }, [active]);
  useEffect(() => {
    let element: Element | null = null;
    const changed = () => {
      const owned = !!document.fullscreenElement && document.fullscreenElement === root.current;
      if (owned) element = document.fullscreenElement;
      setFullscreen(owned);
    };
    document.addEventListener('fullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      if (element && document.fullscreenElement === element)
        void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    if (ended && document.fullscreenElement === root.current && document.fullscreenElement)
      void document.exitFullscreen().catch(() => undefined);
  }, [ended]);
  useEffect(() => {
    const viewport = window.visualViewport;
    document.body.classList.add('in-study-room');
    const update = () => {
      document.documentElement.style.setProperty(
        '--visible-height',
        `${viewport?.height ?? window.innerHeight}px`,
      );
      const keyboard = !!viewport && window.innerHeight - viewport.height > 150;
      document.body.classList.toggle('room-keyboard-open', keyboard);
      if (
        keyboard &&
        document.activeElement instanceof HTMLElement &&
        document.activeElement.matches('input, textarea')
      ) {
        const inputArea = document.activeElement.closest('.chat-panel form, .task-create, .task-edit') ?? document.activeElement;
        inputArea.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
    };
    viewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    update();
    return () => {
      viewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--visible-height');
      document.body.classList.remove('room-keyboard-open');
      document.body.classList.remove('in-study-room');
    };
  }, []);
  function toggleFocus() {
    const next = !active;
    setFocus(next);
    setNotice(
      savePreferences(userId, { focusView: next }) ? '' : '视图已切换，但浏览器未允许保存偏好。',
    );
    if (!next && document.fullscreenElement === root.current && document.fullscreenElement)
      void document.exitFullscreen().catch(() => setNotice('请按 Esc 退出全屏。'));
  }
  async function toggleFullscreen() {
    setNotice('');
    if (document.fullscreenElement === root.current && document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        setNotice('请按 Esc 退出全屏。');
      }
      return;
    }
    setFocus(true);
    if (!document.fullscreenEnabled || !root.current?.requestFullscreen) {
      setNotice('此浏览器不支持全屏，已使用普通专注视图。');
      return;
    }
    try {
      await root.current.requestFullscreen();
    } catch {
      setNotice('未能进入全屏，仍可使用普通专注视图。');
    }
  }
  return {
    root,
    active,
    fullscreen,
    notice,
    toggleFocus,
    toggleFullscreen,
  };
}
