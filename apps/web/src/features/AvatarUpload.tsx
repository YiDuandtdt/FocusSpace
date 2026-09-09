import { useEffect, useState } from 'react';
import type { User } from '@focusspace/shared';
import { errorMessage } from '../api';

export function AvatarUpload({ user, onSave }: { user: User; onSave(user: User): void }) {
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function upload() {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/users/me/avatar', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? '头像上传失败');
      onSave(data.user);
      setFile(null);
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="avatar-upload">
      <label>
        上传账号头像
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={async (e) => {
            const chosen = e.target.files?.[0];
            setSaved(false);
            setError('');
            if (!chosen) return;
            if (
              !['image/png', 'image/jpeg', 'image/webp'].includes(chosen.type) ||
              chosen.size > 2 * 1024 * 1024 ||
              !chosen.size
            ) {
              setError('请选择 2 MB 以内的 PNG、JPEG 或 WebP 图片');
              return;
            }
            try {
              const bitmap = await createImageBitmap(chosen);
              const pixels = bitmap.width * bitmap.height;
              bitmap.close();
              if (pixels > 16_000_000) throw new Error();
              setFile(chosen);
            } catch {
              setError('无法读取图片，或超过 1600 万像素。');
            }
          }}
        />
      </label>
      <p className="muted">静态 PNG / JPEG / WebP · 最多 2 MB · 保存为正方形头像</p>
      {preview || user.avatarUrl ? (
        <img
          src={preview || user.avatarUrl!}
          alt="账号头像预览"
          width="72"
          height="72"
          style={{ borderRadius: '50%', objectFit: 'cover' }}
        />
      ) : null}
      <button
        type="button"
        className="button secondary"
        disabled={!file || busy}
        onClick={() => void upload()}
      >
        {busy ? '正在保存…' : '保存上传头像'}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {saved ? <p role="status">头像已保存，不改变 3D 形象。</p> : null}
    </section>
  );
}
