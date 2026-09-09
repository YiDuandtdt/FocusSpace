import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// A small resource owner, shared by all furniture or by one replaceable avatar.
export function geometryKit() {
  const box = new RoundedBoxGeometry(1, 1, 1, 2, 0.09);
  const softbox = new RoundedBoxGeometry(1, 1, 1, 3, 0.22);
  const sphere = new THREE.SphereGeometry(1, 12, 8);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
  const cone = new THREE.CylinderGeometry(0.7, 1, 1, 16);
  const torus = new THREE.TorusGeometry(1, 0.11, 6, 24);
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  function material(color: string) {
    let result = materials.get(color);
    if (!result) {
      result = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
      materials.set(color, result);
    }
    return result;
  }
  function mesh(
    parent: THREE.Object3D,
    shape: 'box' | 'softbox' | 'sphere' | 'cylinder' | 'cone' | 'torus',
    color: string,
    position: [number, number, number],
    scale: [number, number, number],
  ) {
    const object = new THREE.Mesh(
      { box, softbox, sphere, cylinder, cone, torus }[shape],
      material(color),
    );
    object.castShadow = true;
    object.receiveShadow = true;
    object.position.set(...position);
    object.scale.set(...scale);
    parent.add(object);
    return object;
  }
  return {
    mesh,
    material,
    materials,
    dispose() {
      box.dispose();
      softbox.dispose();
      sphere.dispose();
      cylinder.dispose();
      cone.dispose();
      torus.dispose();
      materials.forEach((value) => value.dispose());
    },
  };
}
