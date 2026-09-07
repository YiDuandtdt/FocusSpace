import * as THREE from 'three';
import type { Member } from '@focusspace/shared';
import { geometryKit } from './geometry';

export interface AvatarModel {
  root: THREE.Group;
  update(member: Member): void;
  animate(seconds: number, reducedMotion: boolean): void;
  dispose(): void;
}

// A GLB implementation can replace this factory while retaining this small interface.
export function createAvatar(member: Member): AvatarModel {
  const kit = geometryKit();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.position.y = 0.72;
  const palette = { lake: '#688c9d', sage: '#8b9e7d', lilac: '#a696b8', sun: '#d4ac64' };
  const shirt = palette[member.avatarId];
  kit.mesh(body, 'box', shirt, [0, 0.42, 0], [0.46, 0.6, 0.32]);
  const head = new THREE.Group();
  head.position.y = 0.97;
  body.add(head);
  kit.mesh(head, 'sphere', '#ecc8a6', [0, 0, 0], [0.27, 0.3, 0.25]);
  kit.mesh(head, 'sphere', '#4e4841', [0, 0.15, -0.025], [0.28, 0.2, 0.25]);
  for (const x of [-0.09, 0.09])
    kit.mesh(head, 'sphere', '#35423e', [x, 0.015, 0.235], [0.023, 0.029, 0.018]);
  // Four silhouettes reuse the existing profile choices: headphones, sprout, beret, cap.
  if (member.avatarId === 'lake') {
    kit.mesh(head, 'box', '#304e5d', [0, 0.3, 0], [0.5, 0.06, 0.1]);
    for (const x of [-0.28, 0.28])
      kit.mesh(head, 'box', '#304e5d', [x, 0.05, 0], [0.09, 0.21, 0.16]);
  } else if (member.avatarId === 'sage') {
    kit.mesh(head, 'cylinder', '#72876b', [0, 0.28, 0], [0.29, 0.1, 0.27]);
    kit.mesh(head, 'sphere', '#72876b', [0.1, 0.4, 0], [0.13, 0.06, 0.05]).rotation.z = 0.6;
  } else if (member.avatarId === 'lilac') {
    kit.mesh(head, 'sphere', shirt, [0.04, 0.27, 0], [0.32, 0.13, 0.28]).rotation.z = -0.2;
  } else {
    kit.mesh(head, 'sphere', shirt, [0, 0.22, 0], [0.29, 0.15, 0.26]);
    kit.mesh(head, 'box', shirt, [0, 0.2, 0.23], [0.4, 0.045, 0.25]);
  }
  const arms = [-1, 1].map((side) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.3, 0.63, 0);
    body.add(arm);
    kit.mesh(arm, 'box', shirt, [0, -0.2, 0], [0.13, 0.4, 0.16]);
    kit.mesh(arm, 'sphere', '#ecc8a6', [0, -0.43, 0], [0.08, 0.08, 0.08]);
    return arm;
  });
  for (const x of [-0.14, 0.14]) {
    kit.mesh(root, 'box', '#4d5b55', [x, 0.65, 0.19], [0.17, 0.17, 0.48]);
    kit.mesh(root, 'box', '#4d5b55', [x, 0.39, 0.36], [0.15, 0.48, 0.16]);
    kit.mesh(root, 'box', '#efe9d9', [x, 0.13, 0.43], [0.2, 0.13, 0.3]);
  }
  let status = member.status;
  const animate = (seconds: number, reduced: boolean) => {
    const wave = reduced ? 0 : Math.sin(seconds * 1.6 + member.seatIndex) * 0.018;
    body.position.y = 0.72 + wave;
    body.rotation.x = status === 'FOCUSING' ? 0.26 : status === 'BREAKING' ? -0.2 : 0;
    head.rotation.x = status === 'FOCUSING' ? 0.2 : status === 'DISCONNECTED' ? 0.3 : 0;
    arms.forEach((arm, index) => {
      arm.rotation.z = status === 'BREAKING' ? (index === 0 ? -2.2 : 2.2) : 0;
      arm.rotation.x =
        status === 'FOCUSING'
          ? -1.12 + (index ? wave * 3 : 0)
          : status === 'READY' && index === 1
            ? -2.6
            : -0.15;
    });
  };
  const update = (next: Member) => {
    status = next.status;
    root.visible = status !== 'AFK';
    kit.materials.forEach((material) => {
      material.transparent = status === 'DISCONNECTED';
      material.opacity = status === 'DISCONNECTED' ? 0.32 : 1;
      material.depthWrite = status !== 'DISCONNECTED';
    });
    animate(0, true);
  };
  update(member);
  return {
    root,
    update,
    animate,
    dispose: () => {
      root.removeFromParent();
      kit.dispose();
    },
  };
}
