import * as THREE from 'three';

export const PALETTE = {
  floor: 0xeef2f7,
  floorEdge: 0xdde5ee,
  steel: 0xa8b8ca,
  steelDark: 0x7d90a6,
  upright: 0x93a9c0,
  beam: 0x276bb9,
  pallet: 0xd8b184,
  palletDark: 0xb8905f,
  carton: 0xe0c49c,
  cartonAlt: 0xc9a479,
  cold: 0xf2f8ff,
  conveyor: 0xb9c7d8,
  machine: 0x9fb0c3,
  truckBody: 0xffffff,
  truckChassis: 0x64748b,
  glass: 0xbfe0fb,
  hazard: 0xf5c542,
  worker: 0xf59e0b,
  workerAlt: 0x276bb9,
  agv: 0xb05c00,
  agvAlt: 0x276bb9,
  accent: 0x276bb9,
  coldZone: 0x2ba04c,
  frozenZone: 0x7c5cd6,
  flowZone: 0x14a3a3,
  highbay: 0x2f7fd4,
  warning: 0xd94b4b,
};

export interface MaterialKit {
  floor: THREE.MeshStandardMaterial;
  zonePatch: THREE.MeshBasicMaterial;
  wall: THREE.MeshStandardMaterial;
  upright: THREE.MeshStandardMaterial;
  beam: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  steelDark: THREE.MeshStandardMaterial;
  pallet: THREE.MeshStandardMaterial;
  palletInstanced: THREE.MeshStandardMaterial;
  carton: THREE.MeshStandardMaterial;
  cold: THREE.MeshStandardMaterial;
  conveyor: THREE.MeshStandardMaterial;
  machine: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  hazard: THREE.MeshStandardMaterial;
  emissive: THREE.MeshBasicMaterial;
  truckBody: THREE.MeshStandardMaterial;
  truckChassis: THREE.MeshStandardMaterial;
  wheel: THREE.MeshStandardMaterial;
  worker: THREE.MeshStandardMaterial;
  workerInstanced: THREE.MeshStandardMaterial;
  agv: THREE.MeshStandardMaterial;
  selection: THREE.MeshBasicMaterial;
  path: THREE.MeshBasicMaterial;
}

export function createMaterials(): MaterialKit {
  return {
    floor: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0.03,
    }),
    zonePatch: new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    wall: new THREE.MeshStandardMaterial({
      color: 0xe8eef6,
      roughness: 0.88,
      metalness: 0.04,
      side: THREE.DoubleSide,
    }),
    upright: new THREE.MeshStandardMaterial({ color: PALETTE.upright, roughness: 0.6, metalness: 0.25 }),
    beam: new THREE.MeshStandardMaterial({ color: PALETTE.beam, roughness: 0.45, metalness: 0.2 }),
    steel: new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.5, metalness: 0.45 }),
    steelDark: new THREE.MeshStandardMaterial({ color: PALETTE.steelDark, roughness: 0.62, metalness: 0.4 }),
    pallet: new THREE.MeshStandardMaterial({ color: PALETTE.pallet, roughness: 0.95, metalness: 0 }),
    palletInstanced: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, vertexColors: true }),
    carton: new THREE.MeshStandardMaterial({ color: PALETTE.carton, roughness: 0.92, metalness: 0 }),
    cold: new THREE.MeshStandardMaterial({ color: PALETTE.cold, roughness: 0.45, metalness: 0.05 }),
    conveyor: new THREE.MeshStandardMaterial({ color: PALETTE.conveyor, roughness: 0.55, metalness: 0.35 }),
    machine: new THREE.MeshStandardMaterial({ color: PALETTE.machine, roughness: 0.6, metalness: 0.3 }),
    glass: new THREE.MeshStandardMaterial({
      color: PALETTE.glass,
      roughness: 0.15,
      metalness: 0.08,
      transparent: true,
      opacity: 0.5,
    }),
    hazard: new THREE.MeshStandardMaterial({ color: PALETTE.hazard, roughness: 0.6, metalness: 0.05 }),
    emissive: new THREE.MeshBasicMaterial({ color: 0xcfe6fb, side: THREE.DoubleSide }),
    truckBody: new THREE.MeshStandardMaterial({ color: PALETTE.truckBody, roughness: 0.55, metalness: 0.08 }),
    truckChassis: new THREE.MeshStandardMaterial({ color: PALETTE.truckChassis, roughness: 0.7, metalness: 0.3 }),
    wheel: new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.9, metalness: 0.05 }),
    worker: new THREE.MeshStandardMaterial({ color: PALETTE.worker, roughness: 0.7, metalness: 0.05 }),
    workerInstanced: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.7,
      metalness: 0.05,
      vertexColors: true,
    }),
    agv: new THREE.MeshStandardMaterial({ color: PALETTE.agv, roughness: 0.45, metalness: 0.25 }),
    selection: new THREE.MeshBasicMaterial({
      color: PALETTE.accent,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    path: new THREE.MeshBasicMaterial({
      color: 0xe08a1e,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    }),
  };
}

/**
 * three.js only applies `InstancedMesh.setColorAt()` when the material has
 * `vertexColors` enabled **and** the geometry carries a `color` attribute
 * (otherwise the missing attribute defaults to black and tints everything).
 * Adding a neutral white attribute makes instance colours work as intended.
 */
export function enableInstanceColor(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3).fill(1);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Height of the visible warehouse shell (cut-away roof for a digital-twin look). */
export const SHELL_HEIGHT = 9.5;
