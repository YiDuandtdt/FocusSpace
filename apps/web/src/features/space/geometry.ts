import * as THREE from 'three';

// A small resource owner, shared by all furniture or by one replaceable avatar.
export function geometryKit() {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const sphere = new THREE.SphereGeometry(1, 12, 8);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
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
    shape: 'box' | 'sphere' | 'cylinder',
    color: string,
    position: [number, number, number],
    scale: [number, number, number],
  ) {
    const object = new THREE.Mesh({ box, sphere, cylinder }[shape], material(color));
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
      sphere.dispose();
      cylinder.dispose();
      materials.forEach((value) => value.dispose());
    },
  };
}
