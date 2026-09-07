import { useEffect, useRef, useState } from 'react';

export function AmbientAudio() {
  const audio = useRef<HTMLAudioElement>(null);
  const alive = useRef(true);
  const [playing, setPlaying] = useState(false);
  const [pending, setPending] = useState(false);
  const [volume, setVolume] = useState(35);
  const [error, setError] = useState('');
  useEffect(() => {
    alive.current = true;
    const element = audio.current!;
    element.src = '/audio/window-rain.wav';
    element.volume = 0.35;
    return () => {
      alive.current = false;
      element.pause();
      element.removeAttribute('src');
      element.load();
    };
  }, []);
  async function toggle() {
    const element = audio.current;
    if (!element) return;
    if (!element.paused) {
      element.pause();
      return;
    }
    setPending(true);
    setError('');
    try {
      if (element.error) element.load();
      await element.play();
      if (!alive.current) element.pause();
    } catch {
      if (alive.current) setError('雨声未能播放，请检查声音设置或网络后重试。');
    } finally {
      if (alive.current) setPending(false);
    }
  }
  return (
    <div className="ambient-audio" aria-label="个人环境音">
      <audio
        ref={audio}
        src="/audio/window-rain.wav"
        loop
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => {
          setPlaying(false);
          setPending(false);
          setError('雨声资源加载失败，可重试播放。');
        }}
      />
      <div className="audio-title">
        <span aria-hidden="true">☂</span>
        <div>
          <strong>窗边雨声</strong>
          <small>仅自己听见 · 合成环境音</small>
        </div>
      </div>
      <button
        className="button secondary"
        onClick={() => void toggle()}
        disabled={pending}
        aria-pressed={playing}
      >
        {pending ? '正在加载…' : playing ? '暂停雨声' : '播放雨声'}
      </button>
      <label className="audio-volume">
        音量 <output>{volume}%</output>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={volume}
          aria-label="环境音音量"
          onChange={(event) => {
            const value = Number(event.target.value);
            setVolume(value);
            if (audio.current) audio.current.volume = value / 100;
          }}
        />
      </label>
      {error ? (
        <p className="audio-error" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}
