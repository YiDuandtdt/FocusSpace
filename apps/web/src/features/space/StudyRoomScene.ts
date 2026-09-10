import * as THREE from 'three';
import {
  DEFAULT_SPACE,
  type Member,
  type Phase,
  type RoomTheme,
  type SpaceConfig,
} from '@focusspace/shared';
import { themes } from './themes';
import { createAvatar, type AvatarModel } from './AvatarModel';
import { createRoomArt } from './RoomArt';
import { memberLabels, memberSymbols, SEATS } from './memberPresentation';

export type SceneState = {
  members: Member[];
  phase: Phase;
  userId?: string;
  theme: RoomTheme;
  space?: SpaceConfig;
  seed?: number;
  completedUsers?: string[];
  canSelectSeat?: boolean;
  onSeatSelect?: (seatIndex: number) => void;
};
export type StudyRoomScene = { update(state: SceneState): void; dispose(): void };
export function createStudyRoomScene(host: HTMLDivElement, onFailure: () => void): StudyRoomScene {
  const scene = new THREE.Scene(),
    camera = new THREE.OrthographicCamera(-6, 6, 4, -4, 0.1, 70);
  const cameraTarget = new THREE.Vector3(0, 1, 0),
    radius = Math.hypot(7.6, 12);
  let yaw = Math.atan2(7.6, 12),
    zoom = 1;
  camera.position.set(7.6, 8.6, 12);
  camera.lookAt(cameraTarget);
  const roomCorners = [
    [-4.95, -0.48, -3.45],
    [4.95, -0.48, -3.45],
    [-4.95, -0.48, 3.45],
    [4.95, -0.48, 3.45],
    [-4.95, 3.72, -3.45],
    [4.95, 3.72, -3.45],
    [-4.95, 3.72, 3.45],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const background = new THREE.Color('#e6e9dd'),
    target = background.clone();
  scene.background = background;
  const fill = new THREE.HemisphereLight('#fff4df', '#a5ad92', 2.1);
  const sun = new THREE.DirectionalLight('#fff1d4', 3);
  sun.position.set(-3, 8, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 0.5, far: 22 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  const bounce = new THREE.DirectionalLight('#e1eeef', 0.6);
  bounce.position.set(4, 5, -1);
  scene.add(fill, sun, bounce);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.touchAction = 'none';
  const labels = SEATS.map((seat) => {
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'scene-seat-label';
    label.dataset.seat = String(seat.index);
    label.addEventListener('click', () => {
      if (!state.members.some((member) => member.seatIndex === seat.index) && state.canSelectSeat)
        state.onSeatSelect?.(seat.index);
    });
    host.append(label);
    return label;
  });
  const avatars = new Map<string, { model: AvatarModel; key: string }>();
  let art: ReturnType<typeof createRoomArt> | undefined,
    artKey = '',
    renderer: THREE.WebGLRenderer | undefined;
  let observer: ResizeObserver | undefined, intersection: IntersectionObserver | undefined;
  let disposed = false,
    frame = 0,
    last = -Infinity,
    inView = true;
  let state: SceneState = { members: [], phase: 'LOBBY', theme: 'library' };
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const pointers = new Map<number, { x: number; y: number }>();
  let previousPinch = 0;
  function pointerDown(event: PointerEvent) {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      previousPinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    }
  }
  function pointerMove(event: PointerEvent) {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      yaw += (event.clientX - previous.x) * 0.008;
      updateCamera();
    } else {
      const [a, b] = [...pointers.values()],
        distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (previousPinch) zoom = THREE.MathUtils.clamp(zoom * (distance / previousPinch), 0.65, 1.8);
      previousPinch = distance;
      updateCamera();
    }
  }
  function pointerUp(event: PointerEvent) {
    pointers.delete(event.pointerId);
    previousPinch = 0;
  }
  function wheel(event: WheelEvent) {
    event.preventDefault();
    zoom = THREE.MathUtils.clamp(zoom * Math.exp(-event.deltaY * 0.001), 0.65, 1.8);
    updateCamera();
  }
  function keyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      yaw += event.key === 'ArrowLeft' ? -0.12 : 0.12;
      event.preventDefault();
      updateCamera();
    } else if (event.key === '+' || event.key === '=' || event.key === '-') {
      zoom = THREE.MathUtils.clamp(zoom * (event.key === '-' ? 0.9 : 1.1), 0.65, 1.8);
      event.preventDefault();
      updateCamera();
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    intersection?.disconnect();
    document.removeEventListener('visibilitychange', resume);
    motion.removeEventListener('change', resume);
    canvas.removeEventListener('webglcontextlost', fail);
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointermove', pointerMove);
    canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointercancel', pointerUp);
    canvas.removeEventListener('wheel', wheel);
    host.removeEventListener('keydown', keyDown);
    avatars.forEach((a) => a.model.dispose());
    avatars.clear();
    art?.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
    canvas.remove();
    labels.forEach((l) => l.remove());
  }
  function fail(event?: Event) {
    event?.preventDefault();
    if (!disposed) {
      dispose();
      onFailure();
    }
  }
  function draw(now: number) {
    frame = 0;
    if (disposed || document.hidden || !inView) return;
    const reduced = motion.matches;
    if (now - last >= 1000 / 30 || reduced) {
      const blend = reduced ? 1 : 1 - Math.exp(-Math.min((now - last) / 1000, 0.1) * 3);
      last = now;
      background.lerp(target, blend);
      avatars.forEach((a) => a.model.animate(now / 1000, reduced));
      art?.rain.children.forEach((drop, i) => {
        drop.position.y = reduced ? 1.5 + (i % 5) * 0.28 : 3 - ((i * 0.371 + now / 3400) % 1) * 1.5;
      });
      try {
        renderer?.render(scene, camera);
      } catch {
        fail();
        return;
      }
    }
    if (!reduced) frame = requestAnimationFrame(draw);
  }
  function resume() {
    cancelAnimationFrame(frame);
    if (!disposed && !document.hidden && inView) {
      last = -Infinity;
      frame = requestAnimationFrame(draw);
    }
  }
  function positionLabels() {
    SEATS.forEach((seat, i) => {
      const p = new THREE.Vector3(seat.x, i < 4 ? 2.4 : 0.12, i < 4 ? seat.z : 2.8).project(camera);
      labels[i]!.style.left = `${(p.x * 0.5 + 0.5) * 100}%`;
      labels[i]!.style.top = `${(-p.y * 0.5 + 0.5) * 100}%`;
    });
  }
  function layout(resizeRenderer: boolean) {
    if (!renderer || disposed) return;
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    camera.updateMatrixWorld();
    const bounds = new THREE.Box3().setFromPoints(
        roomCorners.map((corner) => corner.clone().applyMatrix4(camera.matrixWorldInverse)),
      ),
      center = bounds.getCenter(new THREE.Vector3()),
      aspect = width / height,
      hh = Math.max(
        (bounds.max.y - bounds.min.y) / 2 + 0.22,
        ((bounds.max.x - bounds.min.x) / 2 + 0.25) / aspect,
      );
    Object.assign(camera, {
      left: center.x - hh * aspect,
      right: center.x + hh * aspect,
      top: center.y + hh,
      bottom: center.y - hh,
    });
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    if (resizeRenderer) {
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      renderer.setSize(width, height, false);
    }
    positionLabels();
    resume();
  }
  function resize() {
    layout(true);
  }
  function updateCamera() {
    camera.position.set(Math.sin(yaw) * radius, 8.6, Math.cos(yaw) * radius);
    camera.lookAt(cameraTarget);
    layout(false);
  }
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'low-power',
      preserveDrawingBuffer: true,
    });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.debug.onShaderError = () => queueMicrotask(() => fail());
    host.prepend(canvas);
    canvas.addEventListener('webglcontextlost', fail);
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerUp);
    canvas.addEventListener('wheel', wheel, { passive: false });
    host.addEventListener('keydown', keyDown);
    document.addEventListener('visibilitychange', resume);
    motion.addEventListener('change', resume);
    observer = new ResizeObserver(resize);
    observer.observe(host);
    intersection = new IntersectionObserver(([entry]) => {
      inView = !!entry?.isIntersecting;
      resume();
    });
    intersection.observe(host);
    resize();
  } catch (e) {
    dispose();
    throw e;
  }
  return {
    dispose,
    update(next) {
      if (disposed) return;
      state = next;
      const config = next.space ?? { ...DEFAULT_SPACE, theme: next.theme };
      const key = JSON.stringify([config, next.seed ?? 1]);
      if (key !== artKey) {
        art?.dispose();
        art = createRoomArt(config, next.seed ?? 1);
        scene.add(art.root);
        artKey = key;
      }
      const p = themes[config.theme];
      target.set(p.background);
      sun.color.set(config.light === 'light.warm' ? '#ffcf91' : p.light);
      sun.intensity = config.light === 'light.warm' ? 2.2 : 3;
      fill.intensity = config.theme === 'night' ? 1.5 : 2.1;
      const active = new Set(next.members.map((m) => m.userId));
      avatars.forEach((a, id) => {
        if (!active.has(id)) {
          a.model.dispose();
          avatars.delete(id);
        }
      });
      SEATS.forEach((seat) => {
        const member = next.members.find((m) => m.seatIndex === seat.index),
          label = labels[seat.index]!;
        label.className = `scene-seat-label ${member ? 'is-occupied' : 'is-empty'} ${!member && next.canSelectSeat ? 'can-select' : ''} ${member?.userId === next.userId ? 'is-me' : ''}`;
        label.dataset.userId = member?.userId ?? '';
        label.dataset.status = member?.status ?? 'EMPTY';
        label.dataset.completed = String(
          next.completedUsers?.includes(member?.userId ?? '') ?? false,
        );
        label.dataset.compact = member
          ? `${String(seat.index + 1).padStart(2, '0')} ${memberSymbols[member.status]}`
          : '';
        label.replaceChildren();
        label.disabled = !!member || !next.canSelectSeat;
        label.setAttribute(
          'aria-label',
          member
            ? `${member.nickname}${member.userId === next.userId ? '，你' : ''}，${memberLabels[member.status]}`
            : `选择座位 ${String(seat.index + 1).padStart(2, '0')}`,
        );
        if (!member) {
          label.title = next.canSelectSeat ? '选择这个座位' : '';
          return;
        }
        const name = document.createElement('strong'),
          status = document.createElement('span');
        name.textContent = `${String(seat.index + 1).padStart(2, '0')} · ${member.nickname}${member.userId === next.userId ? ' · 你' : ''}`;
        status.textContent = `${memberSymbols[member.status]} ${memberLabels[member.status]}`;
        if (next.completedUsers?.includes(member.userId))
          status.textContent = '✓ 完成了一个任务';
        label.append(name, status);
        label.title = name.textContent + ' · ' + status.textContent;
        const avatarKey = JSON.stringify(member.character ?? null);
        let a = avatars.get(member.userId);
        if (a && a.key !== avatarKey) {
          a.model.dispose();
          avatars.delete(member.userId);
          a = undefined;
        }
        if (!a) {
          a = { model: createAvatar(member), key: avatarKey };
          avatars.set(member.userId, a);
          scene.add(a.model.root);
        }
        a.model.root.position.set(seat.x, 0, seat.z);
        a.model.root.rotation.y = seat.rotation;
        a.model.update(member);
      });
      resume();
    },
  };
}
