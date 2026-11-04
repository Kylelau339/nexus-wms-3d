import * as THREE from 'three';
import type { Location } from '../domain/types';
import { makeGlowTexture } from './textures';

export interface PathOverlay {
  group: THREE.Group;
  setPath(points: THREE.Vector3[]): void;
  setVisible(visible: boolean): void;
  update(time: number): void;
}

export function createPathOverlay(): PathOverlay {
  const group = new THREE.Group();
  group.name = 'pick-path';

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 512), 3));
  const material = new THREE.LineDashedMaterial({
    color: 0xffc247,
    dashSize: 1.4,
    gapSize: 0.9,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = 8;
  group.add(line);

  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffd76e, transparent: true, depthTest: false }),
  );
  marker.renderOrder = 9;
  group.add(marker);

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 2.4),
    new THREE.MeshBasicMaterial({
      map: makeGlowTexture('#e08a1e'),
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.NormalBlending,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.renderOrder = 7;
  group.add(glow);

  let points: THREE.Vector3[] = [];
  let visible = false;

  return {
    group,
    setPath(next: THREE.Vector3[]): void {
      points = next;
      const attr = geometry.getAttribute('position') as THREE.BufferAttribute;
      const count = Math.min(next.length, 512);
      for (let i = 0; i < count; i++) {
        const p = next[i]!;
        attr.setXYZ(i, p.x, p.y, p.z);
      }
      attr.needsUpdate = true;
      geometry.setDrawRange(0, count);
      geometry.computeBoundingSphere();
      line.computeLineDistances();
      visible = count > 1;
      group.visible = visible;
    },
    setVisible(next: boolean): void {
      visible = next;
      group.visible = next && points.length > 1;
    },
    update(time: number): void {
      if (!visible || points.length < 2) return;
      // three.js has no dashOffset on LineDashedMaterial, so the dash "breathes"
      // while the travelling marker conveys direction of travel.
      material.dashSize = 1.35 + Math.sin(time * 2.4) * 0.35;
      material.gapSize = 0.95 - Math.sin(time * 2.4) * 0.15;
      const total = points.length - 1;
      const t = (time * 0.22) % 1;
      const scaled = t * total;
      const index = Math.min(total - 1, Math.floor(scaled));
      const frac = scaled - index;
      const a = points[index]!;
      const b = points[index + 1]!;
      const pos = new THREE.Vector3().lerpVectors(a, b, frac);
      marker.position.copy(pos);
      marker.position.y += 0.5;
      glow.position.set(pos.x, 0.05, pos.z);
    },
  };
}

export interface MarkerPool {
  group: THREE.Group;
  setMarkers(points: THREE.Vector3[], color: number): void;
  update(time: number): void;
}

/** Reusable pool of pulsing beacons used to highlight locations. */
export function createMarkerPool(max = 64): MarkerPool {
  const group = new THREE.Group();
  group.name = 'markers';
  const texture = makeGlowTexture('#35e0d0');
  const pool: THREE.Mesh[] = [];

  for (let i = 0; i < max; i++) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.2),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.NormalBlending,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    mesh.renderOrder = 7;
    group.add(mesh);
    pool.push(mesh);
  }

  return {
    group,
    setMarkers(points: THREE.Vector3[], color: number): void {
      for (let i = 0; i < pool.length; i++) {
        const mesh = pool[i]!;
        const point = points[i];
        if (!point) {
          mesh.visible = false;
          continue;
        }
        mesh.visible = true;
        mesh.position.set(point.x, 0.06, point.z);
        (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
      }
    },
    update(time: number): void {
      const pulse = 0.85 + Math.sin(time * 3.2) * 0.18;
      for (const mesh of pool) {
        if (mesh.visible) mesh.scale.setScalar(pulse);
      }
    },
  };
}

/** Build a polyline path (with a mid-height lift) from pick locations. */
export function buildPickPath(locations: Location[]): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (const loc of locations) {
    points.push(new THREE.Vector3(loc.x, loc.y + 0.9, loc.z + 1.15));
  }
  return points;
}
