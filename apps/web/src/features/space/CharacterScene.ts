import * as THREE from 'three';
import type { Member } from '@focusspace/shared';
import { createAvatar } from './AvatarModel';
import { geometryKit } from './geometry';

export function createCharacterScene(host: HTMLDivElement, member: Member, fail: () => void) {
  const scene = new THREE.Scene(),
    camera = new THREE.OrthographicCamera(-1.4, 1.4, 1.5, -1.5, 0.1, 20);
  scene.background = new THREE.Color('#e4e9dd');
  camera.position.set(2.2, 2.3, 4.5);
  camera.lookAt(0, 1.03, 0);
  const kit = geometryKit();
  const display = new THREE.Group();
  scene.add(display);
  let avatar = createAvatar(member),
    key = JSON.stringify(member.character);
  display.add(avatar.root);
  kit.mesh(display, 'cylinder', '#c8cebc', [0, -0.05, 0], [0.87, 0.1, 0.87]);
  kit.mesh(display, 'box', '#9ca88b', [0, 0.61, -0.04], [0.68, 0.13, 0.61]);
  kit.mesh(display, 'box', '#9ca88b', [0, 0.98, -0.33], [0.68, 0.58, 0.11]);
  for (const x of [-0.24, 0.24])
    for (const z of [-0.24, 0.19])
      kit.mesh(display, 'box', '#a38562', [x, 0.3, z], [0.08, 0.6, 0.08]);
  const sun = new THREE.DirectionalLight('#fff0d8', 3);
  sun.position.set(-3, 6, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.normalBias = 0.025;
  scene.add(sun, new THREE.HemisphereLight('#fff7e5', '#a4b099', 2.2));
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  host.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.style.touchAction = 'none';
  let frame = 0,
    disposed = false,
    inView = true,
    last = -Infinity;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const pointers = new Map<number, { x: number; y: number }>();
  let previousPinch = 0;
  function applyZoom(scale: number) {
    camera.zoom = THREE.MathUtils.clamp(camera.zoom * scale, 0.7, 1.9);
    camera.updateProjectionMatrix();
    resume();
  }
  function pointerDown(event: PointerEvent) {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    renderer.domElement.setPointerCapture(event.pointerId);
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
      display.rotation.y += (event.clientX - previous.x) * 0.012;
      resume();
    } else {
      const [a, b] = [...pointers.values()],
        distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (previousPinch) applyZoom(distance / previousPinch);
      previousPinch = distance;
    }
  }
  function pointerUp(event: PointerEvent) {
    pointers.delete(event.pointerId);
    previousPinch = 0;
  }
  function wheel(event: WheelEvent) {
    event.preventDefault();
    applyZoom(Math.exp(-event.deltaY * 0.001));
  }
  function keyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      display.rotation.y += event.key === 'ArrowLeft' ? -0.15 : 0.15;
      event.preventDefault();
      resume();
    } else if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault();
      applyZoom(event.key === '-' ? 0.9 : 1.1);
    }
  }
  function draw(now: number) {
    frame = 0;
    if (disposed || document.hidden || !inView) return;
    if (now - last > 33 || motion.matches) {
      last = now;
      avatar.animate(now / 1000, motion.matches);
      renderer.render(scene, camera);
    }
    if (!motion.matches) frame = requestAnimationFrame(draw);
  }
  function resume() {
    cancelAnimationFrame(frame);
    last = -Infinity;
    if (!disposed) frame = requestAnimationFrame(draw);
  }
  function resize() {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    const h = Math.max(1.35, (1.05 * height) / width);
    camera.left = (-h * width) / height;
    camera.right = (h * width) / height;
    camera.top = h;
    camera.bottom = -h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(width, height, false);
    resume();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  const intersection = new IntersectionObserver(([entry]) => {
    inView = !!entry?.isIntersecting;
    resume();
  });
  intersection.observe(host);
  document.addEventListener('visibilitychange', resume);
  motion.addEventListener('change', resume);
  function lost(e: Event) {
    e.preventDefault();
    dispose();
    fail();
  }
  renderer.domElement.addEventListener('webglcontextlost', lost);
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointermove', pointerMove);
  renderer.domElement.addEventListener('pointerup', pointerUp);
  renderer.domElement.addEventListener('pointercancel', pointerUp);
  renderer.domElement.addEventListener('wheel', wheel, { passive: false });
  host.addEventListener('keydown', keyDown);
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    intersection.disconnect();
    document.removeEventListener('visibilitychange', resume);
    motion.removeEventListener('change', resume);
    renderer.domElement.removeEventListener('webglcontextlost', lost);
    renderer.domElement.removeEventListener('pointerdown', pointerDown);
    renderer.domElement.removeEventListener('pointermove', pointerMove);
    renderer.domElement.removeEventListener('pointerup', pointerUp);
    renderer.domElement.removeEventListener('pointercancel', pointerUp);
    renderer.domElement.removeEventListener('wheel', wheel);
    host.removeEventListener('keydown', keyDown);
    avatar.dispose();
    kit.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }
  resize();
  return {
    dispose,
    update(next: Member) {
      if (disposed) return;
      const nextKey = JSON.stringify(next.character);
      if (nextKey !== key) {
        avatar.dispose();
        avatar = createAvatar(next);
        display.add(avatar.root);
        key = nextKey;
      }
      avatar.update(next);
      resume();
    },
  };
}
