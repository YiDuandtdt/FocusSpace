import * as THREE from 'three';
import { assetColor, type SpaceConfig } from '@focusspace/shared';
import { geometryKit } from './geometry';
import { themes } from './themes';
import { SEATS } from './memberPresentation';

// All furniture stays outside the eight reserved seat envelopes. Units are metres.
export function createRoomArt(config: SpaceConfig, seed: number) {
  const root = new THREE.Group(),
    kit = geometryKit(),
    m = kit.mesh;
  const extra: THREE.BufferGeometry[] = [];
  const p = themes[config.theme],
    wood = assetColor('desk', config.desk),
    chair = assetColor('chair', config.chair);
  const darkWood = config.desk === 'desk.oak' ? '#ab835c' : '#665440';
  m(root, 'box', '#aa9575', [0, -0.24, 0], [9.7, 0.46, 6.8]);
  m(root, 'box', '#dbc7a5', [0, -0.025, 0], [9.6, 0.1, 6.7]);
  for (let i = 0; i < 16; i++) {
    const x = -4.48 + i * 0.59;
    m(root, 'box', i % 3 === 0 ? '#d7bf9b' : '#dfc9a6', [x, 0.035, 0], [0.578, 0.04, 6.56]);
    for (let j = 0; j < 3; j++)
      m(root, 'box', '#c9b28f', [x, 0.058, -2.6 + j * 2 + (i % 2) * 0.6], [0.55, 0.006, 0.014]);
  }
  m(root, 'box', p.wall, [0, 1.8, -3.28], [9.7, 3.6, 0.22]);
  m(root, 'box', p.side, [-4.72, 1.8, 0], [0.22, 3.6, 6.65]);
  m(root, 'box', '#eee3ce', [0, 0.2, -3.12], [9.5, 0.27, 0.14]);
  m(root, 'box', '#ded3bd', [-4.56, 0.2, 0], [0.15, 0.27, 6.5]);
  m(root, 'box', '#f1e7d4', [0, 3.59, -3.28], [9.8, 0.13, 0.28]);
  m(root, 'box', '#e1d5bb', [-4.72, 3.59, 0], [0.28, 0.13, 6.8]);
  const rugColor = assetColor('rug', config.slots.rug);
  m(root, 'box', '#d8c8a7', [0, 0.08, 0.12], [8.12, 0.07, 4.7]);
  m(root, 'box', rugColor, [0, 0.121, 0.12], [7.88, 0.025, 4.46]);
  for (let i = 0; i < 34; i++)
    for (const z of [-2.17, 2.41])
      m(root, 'box', '#e5d8b9', [-3.8 + i * 0.23, 0.14, z], [0.08, 0.01, 0.1]);
  const windowGroup = new THREE.Group();
  root.add(windowGroup);
  windowGroup.position.set(-1.2, 1.12, -3.1);
  if (config.room === 'room.arch') {
    const arch = (color: string, width: number, height: number, depth: number) => {
      const s = new THREE.Shape(),
        r = width / 2;
      s.moveTo(-r, 0);
      s.lineTo(r, 0);
      s.lineTo(r, height - r);
      s.absarc(0, height - r, r, 0, Math.PI, false);
      s.lineTo(-r, 0);
      const g = new THREE.ExtrudeGeometry(s, {
        depth: 0.06,
        bevelEnabled: true,
        bevelThickness: 0.015,
        bevelSize: 0.02,
        bevelSegments: 2,
        steps: 1,
        curveSegments: 20,
      });
      extra.push(g);
      const mesh = new THREE.Mesh(g, kit.material(color));
      mesh.position.z = depth;
      windowGroup.add(mesh);
    };
    arch('#f4e8d3', 3.9, 2.21, 0);
    arch(p.window, 3.65, 2.08, 0.08);
  } else {
    m(windowGroup, 'box', '#eae1cb', [0, 1.06, 0], [5, 2.3, 0.18]);
    m(windowGroup, 'box', p.window, [0, 1.06, 0.11], [4.72, 2.05, 0.06]);
  }
  // Low polygon silhouettes beyond the glass, persistent for every member.
  for (let i = 0; i < 5; i++)
    m(
      windowGroup,
      'sphere',
      config.theme === 'night' ? '#425b65' : '#9ebbb0',
      [-1.6 + i * 0.77, 0.12, 0.155],
      [0.66, 0.38 + ((seed + i * 17) % 4) * 0.05, 0.025],
    );
  m(
    windowGroup,
    'sphere',
    config.theme === 'night' ? '#ffe3aa' : '#f7ecd0',
    [0.9, 1.58, 0.16],
    [0.2, 0.2, 0.015],
  );
  for (const x of [-1.15, 0, 1.15])
    m(windowGroup, 'box', '#f4ead6', [x, 0.9, 0.23], [0.065, 1.8, 0.07]);
  m(
    windowGroup,
    'box',
    '#f4ead6',
    [0, 0.86, 0.23],
    [config.room === 'room.arch' ? 3.6 : 4.8, 0.07, 0.07],
  );
  m(root, 'box', '#c2a582', [-1.2, 1.08, -2.94], [5.1, 0.14, 0.5]);
  for (const x of [-3.75, 1.35]) {
    for (let i = 0; i < 4; i++)
      m(root, 'cylinder', '#e4d9c1', [x + i * 0.075, 2.2, -2.94], [0.073, 2.25, 0.11]);
  }
  // Small radiator under the sill, leaving the far row readable.
  for (let i = 0; i < 11; i++)
    m(root, 'box', '#ede5d4', [-2.25 + i * 0.21, 0.59, -3], [0.13, 0.62, 0.15]);
  const shelf = new THREE.Group();
  shelf.position.set(3.3, 0, -2.82);
  root.add(shelf);
  m(shelf, 'box', darkWood, [0, 1.02, 0], [1.95, 1.95, 0.51]);
  for (const y of [0.45, 1.12]) {
    m(shelf, 'box', '#6a6652', [0, y + 0.15, 0.28], [1.68, 0.54, 0.025]);
    for (let i = 0; i < 7; i++) {
      const h = 0.3 + ((seed + i * 11) % 4) * 0.045;
      m(
        shelf,
        'box',
        ['#859888', '#b49b7f', '#a7b8b4', '#b98570'][i % 4]!,
        [-0.7 + i * 0.215, y - 0.11 + h / 2, 0.31],
        [0.16, h, 0.22],
      );
      m(shelf, 'box', '#e0d5bc', [-0.7 + i * 0.215, y + 0.025, 0.425], [0.095, 0.024, 0.009]);
    }
    m(shelf, 'box', wood, [0, y - 0.15, 0.1], [1.94, 0.11, 0.68]);
  }
  m(shelf, 'box', wood, [0, 2.02, 0.03], [2.04, 0.12, 0.67]);
  for (const x of [-0.76, 0.76]) m(shelf, 'box', darkWood, [x, 0.1, 0.03], [0.14, 0.2, 0.36]);
  function plant(
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    scale = 1,
    flowers = false,
  ) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.scale.setScalar(scale);
    parent.add(g);
    m(g, 'cone', '#bc8f70', [0, 0.23, 0], [0.25, 0.44, 0.25]);
    m(g, 'cylinder', '#d1a485', [0, 0.45, 0], [0.257, 0.055, 0.257]);
    m(g, 'cylinder', '#67543c', [0, 0.47, 0], [0.215, 0.01, 0.215]);
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4,
        h = 0.66 + (i % 3) * 0.19;
      m(
        g,
        'cylinder',
        '#78906b',
        [Math.sin(a) * 0.1, h / 2 + 0.27, Math.cos(a) * 0.1],
        [0.018, h - 0.3, 0.018],
      ).rotation.z = Math.sin(a) * 0.3;
      const leaf = m(
        g,
        'sphere',
        flowers ? '#d9b987' : i % 2 ? '#8da579' : '#6f8b6e',
        [Math.sin(a) * 0.23, h, Math.cos(a) * 0.23],
        flowers ? [0.105, 0.075, 0.105] : [0.24, 0.09, 0.14],
      );
      leaf.rotation.set(Math.cos(a) * 0.5, a, Math.sin(a) * 0.5);
    }
  }
  plant(root, -4.1, 0.06, -1.92, 1.2, config.slots.window === 'window.flowers');
  plant(root, 4.1, 0.06, -1.9, 1.05, config.slots.window === 'window.flowers');
  plant(shelf, 0.55, 2.09, 0, 0.45, config.slots.window === 'window.flowers');
  // Wall slot faces into the cutaway; painting and clock use the same safe envelope.
  const wall = new THREE.Group();
  wall.position.set(-4.55, 2.2, -0.65);
  wall.rotation.y = Math.PI / 2;
  root.add(wall);
  if (config.slots.wall === 'wall.clock') {
    m(wall, 'cylinder', '#a68b66', [0, 0, 0], [0.5, 0.09, 0.5]).rotation.x = Math.PI / 2;
    m(wall, 'cylinder', '#f0e5ce', [0, 0, 0.06], [0.445, 0.015, 0.445]).rotation.x = Math.PI / 2;
    m(wall, 'box', '#6b7160', [0, 0.13, 0.08], [0.035, 0.28, 0.02]).rotation.z = -0.4;
    m(wall, 'box', '#6b7160', [0.11, -0.015, 0.08], [0.25, 0.026, 0.02]);
  } else {
    m(wall, 'box', '#ae8a64', [0, 0, 0], [0.92, 1.25, 0.085]);
    m(wall, 'box', '#eee3c8', [0, 0, 0.05], [0.77, 1.09, 0.025]);
    m(wall, 'box', '#7c8d68', [0, -0.02, 0.075], [0.018, 0.67, 0.008]);
    for (let i = 0; i < 5; i++)
      m(
        wall,
        'sphere',
        i % 2 ? '#9eae82' : '#798d68',
        [(i % 2 ? 1 : -1) * 0.12, -0.26 + i * 0.13, 0.08],
        [0.17, 0.065, 0.006],
      ).rotation.z = i % 2 ? 0.45 : -0.45;
  }
  // Eight matching chairs, generously spaced along a single thick tabletop.
  m(root, 'box', darkWood, [0, 1.03, 0], [7.28, 0.2, 1.91]);
  m(root, 'box', wood, [0, 1.145, 0], [7.35, 0.08, 1.97]);
  for (const x of [-3.05, 3.05])
    for (const z of [-0.62, 0.62]) m(root, 'box', darkWood, [x, 0.56, z], [0.18, 1.04, 0.18]);
  for (const z of [-0.62, 0.62]) m(root, 'box', darkWood, [0, 0.36, z], [6.25, 0.14, 0.1]);
  SEATS.forEach((seat) => {
    const g = new THREE.Group();
    g.position.set(seat.x, 0, seat.z);
    g.rotation.y = seat.rotation;
    root.add(g);
    m(g, 'box', darkWood, [0, 0.565, -0.04], [0.67, 0.12, 0.63]);
    m(g, 'box', chair, [0, 0.643, -0.04], [0.64, 0.12, 0.6]);
    m(g, 'box', darkWood, [0, 0.99, -0.345], [0.69, 0.59, 0.12]);
    m(g, 'box', chair, [0, 1.0, -0.268], [0.6, 0.48, 0.09]);
    for (const x of [-0.255, 0.255])
      for (const z of [-0.24, 0.2]) m(g, 'box', darkWood, [x, 0.3, z], [0.075, 0.56, 0.075]);
    const desk = new THREE.Group();
    desk.position.set(seat.x, 1.2, seat.z * 0.43);
    desk.rotation.y = seat.rotation;
    root.add(desk);
    m(desk, 'box', '#a1ad97', [0, 0, 0], [0.64, 0.032, 0.42]);
    for (const x of [-0.155, 0.155])
      m(desk, 'box', '#f6edd7', [x, 0.025, 0], [0.3, 0.027, 0.39]).rotation.z =
        x < 0 ? 0.028 : -0.028;
    for (let i = 0; i < 4; i++)
      m(desk, 'box', '#c6c5b0', [-0.16, 0.043, -0.12 + i * 0.06], [0.21, 0.005, 0.005]);
    m(desk, 'cylinder', '#ad7953', [0.28, 0.055, 0], [0.016, 0.31, 0.016]).rotation.x = Math.PI / 2;
    if (config.slots.desktop === 'desktop.tea') {
      m(desk, 'cylinder', '#c68e70', [0.49, 0.085, 0.01], [0.093, 0.16, 0.093]);
      m(desk, 'cylinder', '#785848', [0.49, 0.167, 0.01], [0.076, 0.008, 0.076]);
      m(desk, 'torus', '#c68e70', [0.59, 0.09, 0.01], [0.052, 0.052, 0.05]);
    } else {
      for (let i = 0; i < 2; i++)
        m(
          desk,
          'box',
          i ? '#a9bac0' : '#bda57e',
          [0.5, 0.034 + i * 0.064, -0.02],
          [0.25, 0.06, 0.35],
        );
    }
  });
  for (const x of [-1.65, 1.65]) {
    m(root, 'cylinder', '#506c59', [x, 1.23, 0], [0.2, 0.085, 0.2]);
    m(root, 'cylinder', '#baaa79', [x, 1.59, 0], [0.028, 0.71, 0.028]);
    m(root, 'cone', '#65806a', [x, 1.93, 0], [0.3, 0.23, 0.3]);
    m(root, 'cylinder', '#ffe4ae', [x, 1.805, 0], [0.282, 0.024, 0.282]);
    const glow = kit.material('#ffe4ae');
    glow.emissive.set('#ffd389');
    glow.emissiveIntensity = 0.55;
  }
  const rain = new THREE.Group();
  root.add(rain);
  rain.visible = config.theme === 'rain';
  for (let i = 0; i < 15; i++)
    m(
      rain,
      'box',
      '#bdd4d9',
      [-2.8 + i * 0.235, 1.5 + (i % 5) * 0.28, -2.88],
      [0.013, 0.115, 0.008],
    );
  return {
    root,
    rain,
    dispose() {
      root.removeFromParent();
      kit.dispose();
      extra.forEach((g) => g.dispose());
    },
  };
}
