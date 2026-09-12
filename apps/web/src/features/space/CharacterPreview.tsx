import { useEffect, useRef, useState } from 'react';
import type { Member } from '@focusspace/shared';

export function CharacterPreview({ member }: { member: Member }) {
  const host = useRef<HTMLDivElement>(null),
    latest = useRef(member);
  const scene = useRef<{ update(member: Member): void; dispose(): void } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    latest.current = member;
    scene.current?.update(member);
  }, [member]);
  useEffect(() => {
    let cancelled = false;
    void import('./CharacterScene')
      .then(({ createCharacterScene }) => {
        if (!cancelled && host.current)
          scene.current = createCharacterScene(host.current, latest.current, () => setFailed(true));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);
  return (
    <div
      className="character-preview"
      ref={host}
      aria-label="个人虚拟形象实时预览，可拖动旋转并滚动缩放"
      tabIndex={0}
    >
      {failed ? <p role="status">3D 预览暂不可用，仍可选择并保存搭配。</p> : null}
    </div>
  );
}
