import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth';
import { readPreferences, savePreferences } from '../../preferences';
import { tracks, isTrackId, type TrackId } from './tracks';

export function AmbientAudio({ recommended }: { recommended: string }) {
  const { user } = useAuth();
  const audio = useRef<HTMLAudioElement>(null);
  const generation = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [pending, setPending] = useState(false);
  const [sound, setSound] = useState(() => readPreferences(user!.id).sound);
  const [volume, setVolume] = useState(() => readPreferences(user!.id).volume);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = audio.current!;
    element.volume = readPreferences(user!.id).volume / 100;
    return () => {
      generation.current++;
      element.pause();
      element.removeAttribute('src');
      element.load();
    };
  }, [user!.id]);
  async function play(id: TrackId) {
    const element = audio.current!;
    const version = ++generation.current;
    setPending(true);
    setError('');
    const src = tracks.find((track) => track.id === id)!.src;
    if (element.getAttribute('src') !== src) element.src = src;
    else if (element.error) element.load();
    try {
      await element.play();
    } catch {
      if (version === generation.current)
        setError('环境声未能播放，请检查网络或浏览器声音设置后重试。');
    } finally {
      if (version === generation.current) setPending(false);
    }
  }
  function pause() {
    generation.current++;
    audio.current?.pause();
    setPending(false);
  }
  function select(id: TrackId) {
    const resume = playing || pending;
    pause();
    setSound(id);
    setError('');
    audio.current?.removeAttribute('src');
    audio.current?.load();
    if (resume) void play(id);
    if (!savePreferences(user!.id, { sound: id })) setError('声音已切换，但浏览器未允许保存偏好。');
  }
  return (
    <section className="ambient-audio" id="room-audio" aria-label="个人环境音">
      <audio
        ref={audio}
        loop
        preload="none"
        onPlaying={() => {
          setPlaying(true);
          setPending(false);
        }}
        onPause={() => setPlaying(false)}
        onError={() => {
          setPlaying(false);
          setPending(false);
          setError('环境声资源加载失败，请重新播放或选择其他声音。');
        }}
      />
      <label className="audio-title">
        <span aria-hidden="true">♫</span>
        <span>
          环境声
          <select
            aria-label="选择环境声"
            value={sound}
            onChange={(e) => {
              if (isTrackId(e.target.value)) select(e.target.value);
            }}
          >
            {tracks.map((track) => (
              <option value={track.id} key={track.id}>
                {track.name}
              </option>
            ))}
          </select>
          <small>仅自己听见 · 默认关闭 · 循环播放</small>
        </span>
      </label>
      <button
        className="button secondary"
        onClick={() => (playing || pending ? pause() : void play(sound))}
        aria-pressed={playing}
      >
        {pending ? '取消加载' : playing ? '暂停环境声' : '播放环境声'}
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
            if (!savePreferences(user!.id, { volume: value }))
              setError('音量已调整，但浏览器未允许保存偏好。');
          }}
        />
      </label>
      <p className="audio-recommendation">
        此空间适合「{tracks.find((track) => track.id === recommended)?.name}」 · 自由选择{' '}
        <a href="/audio/SOURCES.md" target="_blank" rel="noreferrer">
          声音来源与授权 ↗
        </a>
      </p>
      {error ? (
        <p className="audio-error" role="status">
          {error}
        </p>
      ) : null}
    </section>
  );
}
