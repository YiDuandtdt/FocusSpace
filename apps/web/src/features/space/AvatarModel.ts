import * as THREE from 'three';
import { DEFAULT_CHARACTER, assetColor, stableSeed, type Member } from '@focusspace/shared';
import { geometryKit } from './geometry';

export interface AvatarModel {
  root: THREE.Group;
  update(member: Member): void;
  animate(seconds: number, reducedMotion: boolean): void;
  dispose(): void;
}

// Seated proportions in metres: cushion .61, hips .72, shoulders 1.24, desk 1.14.
export function createAvatar(member: Member): AvatarModel {
  const kit = geometryKit(),
    m = kit.mesh;
  const root = new THREE.Group(),
    body = new THREE.Group(),
    head = new THREE.Group();
  const c = member.character ?? DEFAULT_CHARACTER;
  const skin = assetColor('skin', c.skin),
    hair = assetColor('hairColor', c.hairColor),
    shirt = assetColor('outfit', c.outfit);
  const seed = stableSeed(member.userId),
    offset = (seed % 997) / 157;
  root.add(body);
  body.position.y = 0.73;
  m(body, 'softbox', shirt, [0, 0.29, 0], [0.53, 0.58, 0.39]);
  m(body, 'softbox', shirt, [0.11, 0.3, 0.205], [0.15, 0.12, 0.035]);
  for (const x of [-0.19, -0.12, -0.05, 0.02, 0.09, 0.16])
    m(body, 'box', shirt, [x, 0.04, 0.19], [0.022, 0.06, 0.022]);
  m(body, 'box', '#ebe2d1', [0, 0.55, 0.025], [0.22, 0.07, 0.22]);
  m(body, 'box', shirt, [0, 0.03, 0.005], [0.54, 0.09, 0.37]);
  m(body, 'sphere', skin, [0, 0.61, 0], [0.12, 0.14, 0.12]);
  head.position.set(0, 0.9, 0.015);
  body.add(head);
  m(head, 'sphere', skin, [0, 0, 0], [0.315, 0.335, 0.285]);
  m(head, 'sphere', hair, [0, 0.17, -0.052], [0.329, 0.235, 0.278]);
  for (const side of [-1, 1]) {
    m(head, 'sphere', skin, [side * 0.307, -0.018, 0], [0.061, 0.09, 0.066]);
    m(head, 'sphere', '#bd806b', [side * 0.185, -0.081, 0.229], [0.051, 0.023, 0.015]);
    m(head, 'sphere', '#343a35', [side * 0.108, 0.003, 0.267], [0.027, 0.034, 0.019]);
    m(head, 'box', hair, [side * 0.112, 0.079, 0.266], [0.066, 0.018, 0.016]).rotation.z =
      side * -0.12;
  }
  m(head, 'sphere', skin, [0, -0.055, 0.28], [0.041, 0.037, 0.035]);
  m(head, 'box', '#9a6556', [0, -0.133, 0.251], [0.066, 0.014, 0.014]);
  for (let i = 0; i < 3; i++)
    m(
      head,
      'sphere',
      hair,
      [-0.18 + i * 0.14, 0.158 - i * 0.016, 0.19],
      [0.124, 0.112, 0.1],
    ).rotation.z = -0.25;
  if (c.hair === 'hair.bob')
    for (const side of [-1, 1])
      m(head, 'softbox', hair, [side * 0.276, -0.015, -0.04], [0.14, 0.43, 0.35]);
  if (c.hair === 'hair.bun') {
    m(head, 'sphere', hair, [0, 0.37, -0.16], [0.19, 0.18, 0.17]);
    m(head, 'torus', '#c8ac80', [0, 0.31, -0.14], [0.13, 0.12, 0.13]).rotation.x = Math.PI / 2;
  }
  if (c.accessory === 'accessory.glasses') {
    for (const side of [-1, 1])
      m(head, 'torus', '#605444', [side * 0.122, 0.003, 0.286], [0.092, 0.083, 0.08]);
    m(head, 'box', '#605444', [0, 0.01, 0.291], [0.06, 0.016, 0.018]);
  }
  if (c.accessory === 'accessory.headphones') {
    m(head, 'torus', '#496b66', [0, 0.08, -0.055], [0.345, 0.35, 0.29]);
    for (const side of [-1, 1]) {
      m(head, 'box', '#496b66', [side * 0.329, 0.005, 0], [0.11, 0.22, 0.19]);
      m(head, 'box', '#c8b797', [side * 0.385, 0.005, 0], [0.025, 0.14, 0.12]);
    }
  }
  if (c.accessory === 'accessory.beret') {
    m(head, 'sphere', '#b98566', [0.035, 0.27, -0.01], [0.37, 0.145, 0.32]).rotation.z = -0.15;
    m(head, 'box', '#88624d', [0.04, 0.405, -0.01], [0.045, 0.06, 0.04]);
  }
  const arms = [-1, 1].map((side) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.31, 0.49, 0.015);
    body.add(arm);
    m(arm, 'softbox', shirt, [0, -0.13, 0.035], [0.18, 0.3, 0.2]);
    const forearm = new THREE.Group();
    forearm.position.set(0, -0.25, 0.035);
    arm.add(forearm);
    m(forearm, 'softbox', shirt, [0, -0.09, 0], [0.155, 0.21, 0.16]);
    m(forearm, 'sphere', skin, [0, -0.235, 0], [0.077, 0.094, 0.066]);
    return { arm, forearm };
  });
  for (const x of [-0.145, 0.145]) {
    m(root, 'box', '#59625d', [x, 0.67, 0.17], [0.205, 0.19, 0.49]);
    m(root, 'box', '#59625d', [x, 0.39, 0.37], [0.177, 0.49, 0.18]);
    m(root, 'box', '#f2e8d3', [x, 0.14, 0.44], [0.225, 0.15, 0.33]);
    m(root, 'box', '#b5a891', [x, 0.074, 0.45], [0.23, 0.04, 0.34]);
    m(root, 'box', '#d1c5b1', [x, 0.215, 0.49], [0.15, 0.015, 0.08]);
  }
  let status = member.status,
    last = 0,
    initialized = false;
  const approach = (a: number, b: number, blend: number) => a + (b - a) * blend;
  function animate(seconds: number, reduced: boolean) {
    const dt = Math.min(Math.max(seconds - last, 0), 0.1);
    last = seconds;
    const blend = reduced || !initialized ? 1 : 1 - Math.exp(-dt * 7);
    initialized = true;
    const wave = reduced ? 0 : Math.sin(seconds * (1.45 + (seed % 7) / 20) + offset);
    const focused = status === 'FOCUSING',
      rest = status === 'BREAKING';
    body.position.y = approach(body.position.y, 0.73 + wave * 0.006, blend);
    body.rotation.x = approach(body.rotation.x, focused ? 0.1 : rest ? -0.1 : 0, blend);
    head.rotation.x = approach(
      head.rotation.x,
      focused ? 0.2 : status === 'DISCONNECTED' ? 0.2 : -0.035,
      blend,
    );
    head.rotation.y = approach(
      head.rotation.y,
      reduced || focused ? 0 : Math.sin(seconds * 0.37 + offset) * 0.075,
      blend,
    );
    arms.forEach(({ arm, forearm }, index) => {
      const raised = (status === 'READY' || status === 'ENDED') && index === 1;
      arm.rotation.x = approach(
        arm.rotation.x,
        focused
          ? -0.62
          : raised
            ? -2.55
            : rest && c.motion === 'motion.stretch'
              ? -2.7
              : rest
                ? -0.35
                : -0.12,
        blend,
      );
      arm.rotation.z = approach(
        arm.rotation.z,
        rest
          ? (index ? 1 : -1) * (c.motion === 'motion.stretch' ? 0.75 : 0.48)
          : raised
            ? -0.22
            : 0,
        blend,
      );
      forearm.rotation.x = approach(
        forearm.rotation.x,
        focused ? -1.08 + (index ? wave * 0.055 : 0) : rest ? -1.15 : -0.35,
        blend,
      );
    });
  }
  function update(next: Member) {
    status = next.status;
    root.visible = status !== 'AFK';
    kit.materials.forEach((material) => {
      material.transparent = status === 'DISCONNECTED';
      material.opacity = status === 'DISCONNECTED' ? 0.38 : 1;
      material.depthWrite = status !== 'DISCONNECTED';
    });
  }
  update(member);
  return {
    root,
    update,
    animate,
    dispose() {
      root.removeFromParent();
      kit.dispose();
    },
  };
}
