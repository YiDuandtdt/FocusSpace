import { useEffect, useState } from 'react';
import type { RoomCommand } from '@focusspace/shared';
import { errorMessage } from '../api';
export function Encouragement({
  disabled,
  command,
}: {
  disabled: boolean;
  command: (type: RoomCommand, payload: unknown) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [cooldown, setCooldown] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(false), 10000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(timer);
  }, [message]);
  async function send(symbol: string) {
    if (busy || cooldown) return;
    setBusy(true);
    setCooldown(true);
    try {
      await command('reaction:send', { symbol });
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="encouragement" aria-label="安静鼓励">
      <span>
        {message || (cooldown ? '已送出心意，安静陪伴一会儿' : '安静鼓励 · 每 10 秒一次')}
      </span>
      {(['🌱', '💪', '☕'] as const).map((symbol) => (
        <button
          className="text-button"
          key={symbol}
          disabled={disabled || busy || cooldown}
          aria-label={'发送鼓励 ' + symbol}
          onClick={() => void send(symbol)}
        >
          {symbol}
        </button>
      ))}
    </div>
  );
}
