import * as THREE from 'three';
import type { Member, Phase, RoomTheme } from '@focusspace/shared';
import { themes } from './themes';
import { createAvatar, type AvatarModel } from './AvatarModel';
import { geometryKit } from './geometry';
import { memberLabels, memberSymbols, SEATS } from './memberPresentation';

export type SceneState = {
  members: Member[];
  phase: Phase;
  userId?: string;
  theme: RoomTheme;
  reducedMotion?: boolean;
  completedUsers?: string[];
};
export type StudyRoomScene = { update(state: SceneState): void; dispose(): void };

export function createStudyRoomScene(host: HTMLDivElement, onFailure: () => void): StudyRoomScene {
  const scene = new THREE.Scene();
  const kit = geometryKit();
  const camera = new THREE.OrthographicCamera(-6, 6, 4, -4, 0.1, 60);
  camera.position.set(2.7, 10, 12);
  camera.lookAt(0, 0.7, 0);
  camera.updateMatrixWorld();
  // Frame the actual cutaway room, including the tall left/back walls, at every aspect ratio.
  const corners = [
    [-4.8, 0, -3.3],
    [4.8, 0, -3.3],
    [-4.8, 0, 3.3],
    [4.8, 0, 3.3],
    [-4.8, 3.6, -3.3],
    [4.8, 3.6, -3.3],
    [-4.8, 3.6, 3.3],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
  const bounds = new THREE.Box3().setFromPoints(corners);
  const center = bounds.getCenter(new THREE.Vector3());
  const avatars = new Map<string, { model: AvatarModel; avatarId: Member['avatarId'] }>();
  const labels: HTMLDivElement[] = [];
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  let renderer: THREE.WebGLRenderer | undefined;
  let observer: ResizeObserver | undefined;
  let intersection: IntersectionObserver | undefined;
  let disposed = false;
  let frame = 0;
  let lastFrame = -Infinity;
  let inView = true;
  let phase: Phase = 'LOBBY';
  let theme: RoomTheme = 'rain';
  let reducedMotion = false;
  const rain = new THREE.Group();
  const night = new THREE.Group();
  const library = new THREE.Group();
  const fill = new THREE.HemisphereLight('#fff7e7', '#a2ac93', 2);
  const lamp = new THREE.PointLight('#ffcc88', 0, 7, 2);
  lamp.position.set(0, 2.4, 0);
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const background = new THREE.Color('#e8e4d8');
  const targetBackground = background.clone();
  scene.background = background;
  const daylight = new THREE.DirectionalLight('#fff0d3', 2.4);
  daylight.position.set(-3, 8, 4);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    intersection?.disconnect();
    document.removeEventListener('visibilitychange', resume);
    motion.removeEventListener('change', resume);
    canvas.removeEventListener('webglcontextlost', fail);
    avatars.forEach(({ model }) => model.dispose());
    avatars.clear();
    kit.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
    canvas.remove();
    labels.forEach((label) => label.remove());
  };
  function fail(event?: Event) {
    event?.preventDefault();
    if (disposed) return;
    dispose();
    onFailure();
  }
  function draw(now: number) {
    frame = 0;
    if (disposed || document.hidden || !inView) return;
    const reduced = motion.matches || reducedMotion;
    if (now - lastFrame >= 1000 / 30 || reduced) {
      const blend = reduced ? 1 : 1 - Math.exp(-Math.min((now - lastFrame) / 1000, 0.1) * 3);
      lastFrame = now;
      background.lerp(targetBackground, blend);
      daylight.intensity +=
        (themes[theme].intensity * (phase === 'BREAK' ? 0.88 : 1) - daylight.intensity) * blend;
      rain.children.forEach((drop, index) => {
        drop.position.y = reduced
          ? 1.3 + (index % 5) * 0.34
          : 3.02 - ((index * 0.37 + now / 2600) % 1) * 1.85;
      });
      avatars.forEach(({ model }) => model.animate(now / 1000, reduced));
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
    frame = 0;
    if (!disposed && !document.hidden && inView) {
      lastFrame = -Infinity;
      frame = requestAnimationFrame(draw);
    }
  }
  function resize() {
    if (disposed || !renderer) return;
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    const aspect = width / height;
    const halfHeight = Math.max(
      (bounds.max.y - bounds.min.y) / 2 + 0.22,
      ((bounds.max.x - bounds.min.x) / 2 + 0.22) / aspect,
    );
    camera.left = center.x - halfHeight * aspect;
    camera.right = center.x + halfHeight * aspect;
    camera.top = center.y + halfHeight;
    camera.bottom = center.y - halfHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    camera.updateMatrixWorld();
    SEATS.forEach((seat, index) => {
      const point = new THREE.Vector3(seat.x, 2.25, seat.z).project(camera);
      labels[index]!.style.left = `${(point.x * 0.5 + 0.5) * 100}%`;
      labels[index]!.style.top = `${(-point.y * 0.5 + 0.5) * 100}%`;
    });
    resume();
  }
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'low-power',
      // Reduced motion renders on demand. Retain the last frame when Chromium
      // recomposites the canvas after scrolling or changing viewport size.
      preserveDrawingBuffer: true,
    });
    renderer.debug.onShaderError = () => {
      queueMicrotask(() => fail());
    };
    renderer.setClearColor(background);
    host.append(canvas);
    scene.add(fill, daylight, lamp, rain, night, library);
    const mesh = kit.mesh;
    mesh(scene, 'box', '#c6b292', [0, -0.15, 0], [9.6, 0.3, 6.6]);
    // Thin floor inlays and an inset woven rug provide depth without shadow maps.
    for (let x = -4.2; x <= 4.3; x += 0.6)
      mesh(scene, 'box', '#bca788', [x, 0.006, 0], [0.012, 0.012, 6.6]);
    mesh(scene, 'box', '#a8b5a0', [0, 0.015, 0.05], [7.9, 0.03, 4.4]);
    mesh(scene, 'box', '#e7dfcf', [0, 1.8, -3.25], [9.6, 3.6, 0.16]);
    mesh(scene, 'box', '#d4cbb7', [-4.72, 1.8, 0], [0.16, 3.6, 6.6]);
    mesh(scene, 'box', '#c1d4ce', [-1.2, 2.12, -3.14], [4.8, 2.12, 0.05]);
    for (let i = 0; i < 18; i++)
      mesh(
        rain,
        'box',
        '#a7c3ca',
        [-3.45 + i * 0.25, 1.3, -3.095],
        [0.012, 0.12 + (i % 3) * 0.035, 0.01],
      );
    mesh(night, 'sphere', '#f4deb2', [0.5, 2.73, -3.08], [0.2, 0.2, 0.025]);
    for (let i = 0; i < 4; i++)
      mesh(
        library,
        'box',
        ['#83957b', '#cbb78f'][i % 2]!,
        [2.8, 1.96 + i * 0.1, -2.8],
        [0.65, 0.09, 0.4],
      );
    for (const x of [-3.65, -1.2, 1.25])
      mesh(scene, 'box', '#f7f0de', [x, 2.12, -3.06], [0.1, 2.28, 0.12]);
    for (const y of [1.01, 2.12, 3.23])
      mesh(scene, 'box', '#f7f0de', [-1.2, y, -3.06], [5, 0.09, 0.12]);
    mesh(scene, 'box', '#b09b79', [-1.2, 0.95, -2.97], [5.2, 0.13, 0.38]);
    // A low bookcase leaves the window and avatars readable from the fixed camera.
    mesh(scene, 'box', '#a28a67', [3.35, 0.9, -2.8], [1.7, 1.8, 0.65]);
    for (const y of [0.45, 1.12]) {
      mesh(scene, 'box', '#6e6959', [3.35, y, -2.44], [1.48, 0.53, 0.025]);
      for (let i = 0; i < 6; i++)
        mesh(
          scene,
          'box',
          ['#83957b', '#cbb78f', '#a297aa'][i % 3]!,
          [2.8 + i * 0.21, y, -2.4],
          [0.13, 0.38 + (i % 2) * 0.1, 0.17],
        );
    }
    mesh(scene, 'box', '#b18e62', [0, 1.03, 0], [7.15, 0.18, 1.65]);
    mesh(scene, 'box', '#d6b88a', [0, 1.13, 0], [7.2, 0.04, 1.7]);
    for (const x of [-3.05, 3.05])
      for (const z of [-0.57, 0.57]) mesh(scene, 'box', '#826f53', [x, 0.5, z], [0.15, 1, 0.15]);
    SEATS.forEach((seat) => {
      const chair = new THREE.Group();
      chair.position.set(seat.x, 0, seat.z);
      chair.rotation.y = seat.rotation;
      scene.add(chair);
      mesh(chair, 'cylinder', '#919c87', [0, 0.042, 0], [0.48, 0.015, 0.48]);
      mesh(chair, 'box', '#718873', [0, 0.58, 0], [0.63, 0.13, 0.58]);
      mesh(chair, 'box', '#718873', [0, 0.93, -0.25], [0.63, 0.62, 0.1]);
      for (const x of [-0.24, 0.24])
        mesh(chair, 'box', '#736c59', [x, 0.28, 0], [0.07, 0.56, 0.47]);
      const book = new THREE.Group();
      book.position.set(seat.x, 1.18, seat.z * 0.38);
      book.rotation.y = seat.rotation;
      scene.add(book);
      mesh(book, 'box', '#faf0d8', [0, 0, 0], [0.5, 0.045, 0.35]);
      mesh(book, 'box', '#c2b492', [0, 0.025, 0], [0.015, 0.01, 0.35]);
      const label = document.createElement('div');
      label.className = 'scene-seat-label';
      label.dataset.seat = String(seat.index);
      host.append(label);
      labels.push(label);
    });
    for (const x of [-1.65, 1.65]) {
      mesh(scene, 'cylinder', '#4c6255', [x, 1.19, 0], [0.18, 0.07, 0.18]);
      mesh(scene, 'cylinder', '#4c6255', [x, 1.51, 0], [0.035, 0.64, 0.035]);
      mesh(scene, 'sphere', '#56705c', [x, 1.84, 0], [0.32, 0.13, 0.22]);
      mesh(scene, 'sphere', '#ffe3a1', [x, 1.79, 0], [0.27, 0.025, 0.19]);
    }
    kit.material('#ffe3a1').emissive.set('#ffe3a1');
    kit.material('#ffe3a1').emissiveIntensity = 0.5;
    for (const x of [-4.05, 4.05]) {
      mesh(scene, 'cylinder', '#c19473', [x, 0.29, -1.5], [0.27, 0.58, 0.27]);
      mesh(scene, 'cylinder', '#647756', [x, 0.75, -1.5], [0.035, 0.7, 0.035]);
      for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2;
        mesh(
          scene,
          'sphere',
          '#7d9269',
          [x + Math.cos(angle) * 0.19, 0.9 + i * 0.1, -1.5 + Math.sin(angle) * 0.19],
          [0.24, 0.15, 0.15],
        );
      }
    }
    canvas.addEventListener('webglcontextlost', fail);
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
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    dispose,
    update(state) {
      if (disposed) return;
      phase = state.phase;
      theme = state.theme;
      reducedMotion = !!state.reducedMotion;
      const palette = themes[theme];
      targetBackground.set(palette.background);
      kit.material('#e7dfcf').color.set(palette.wall);
      kit.material('#d4cbb7').color.set(palette.side);
      kit.material('#c1d4ce').color.set(palette.window);
      kit.material('#a8b5a0').color.set(palette.rug);
      kit.material('#d6b88a').color.set(palette.desk);
      daylight.color.set(palette.light);
      fill.intensity = theme === 'night' ? 1.25 : 2;
      lamp.intensity = theme === 'night' ? 9 : 1;
      rain.visible = theme === 'rain';
      night.visible = theme === 'night';
      library.visible = theme === 'library';
      const active = new Set(state.members.map((member) => member.userId));
      avatars.forEach(({ model }, id) => {
        if (!active.has(id)) {
          model.dispose();
          avatars.delete(id);
        }
      });
      SEATS.forEach((seat) => {
        const member = state.members.find((item) => item.seatIndex === seat.index);
        const label = labels[seat.index]!;
        label.className = `scene-seat-label ${member ? 'is-occupied' : 'is-empty'} ${member?.userId === state.userId ? 'is-me' : ''}`;
        label.dataset.status = member?.status ?? 'EMPTY';
        label.dataset.userId = member?.userId ?? '';
        label.dataset.completed = String(
          state.completedUsers?.includes(member?.userId ?? '') ?? false,
        );
        label.replaceChildren();
        const name = document.createElement('strong');
        name.textContent = `${String(seat.index + 1).padStart(2, '0')} · ${member ? member.nickname + (member.userId === state.userId ? ' · 你' : '') : '空座'}`;
        const status = document.createElement('span');
        status.textContent = member
          ? `${memberSymbols[member.status]} ${memberLabels[member.status]}`
          : '等一位学习搭子';
        label.append(name, status);
        if (state.completedUsers?.includes(member?.userId ?? ''))
          status.textContent = '✓ 完成了一个任务';
        label.title = `${name.textContent} · ${status.textContent}`;
        if (!member) return;
        let avatar = avatars.get(member.userId);
        if (avatar && avatar.avatarId !== member.avatarId) {
          avatar.model.dispose();
          avatars.delete(member.userId);
          avatar = undefined;
        }
        if (!avatar) {
          avatar = { model: createAvatar(member), avatarId: member.avatarId };
          avatars.set(member.userId, avatar);
          scene.add(avatar.model.root);
        }
        avatar.model.root.position.set(seat.x, 0, seat.z);
        avatar.model.root.rotation.y = seat.rotation;
        avatar.model.update(member);
      });
      resume();
    },
  };
}
