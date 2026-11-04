import * as THREE from 'three';
import type { Agv, Vehicle, Worker } from '../domain/types';
import { PALETTE, enableInstanceColor, type MaterialKit } from './materials';

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3(1, 1, 1);
const tmpColor = new THREE.Color();

/* ------------------------------------------------------------------ trucks */

export class TruckActor {
  readonly group = new THREE.Group();
  private readonly cab: THREE.Mesh;
  private readonly beacon: THREE.Mesh;

  constructor(materials: MaterialKit, kind: Vehicle['kind'], accent: number) {
    const trailerLength = kind === 'container' ? 12.4 : kind === 'flatbed' ? 11 : 10.2;
    const trailerHeight = kind === 'container' ? 3.1 : kind === 'flatbed' ? 0.7 : 2.9;
    const trailerWidth = kind === 'van' ? 2.2 : 2.5;

    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(trailerLength + 2.6, 0.42, trailerWidth * 0.86),
      materials.truckChassis,
    );
    chassis.position.set(-0.4, 0.92, 0);
    chassis.castShadow = true;
    this.group.add(chassis);

    if (kind === 'flatbed') {
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(trailerLength, 0.3, trailerWidth),
        materials.steel,
      );
      deck.position.set(-0.9, 1.35, 0);
      deck.castShadow = true;
      this.group.add(deck);
      const load = new THREE.Mesh(
        new THREE.BoxGeometry(trailerLength * 0.72, 1.5, trailerWidth * 0.78),
        materials.carton,
      );
      load.position.set(-1.6, 2.2, 0);
      load.castShadow = true;
      this.group.add(load);
    } else {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(trailerLength, trailerHeight, trailerWidth),
        materials.truckBody,
      );
      body.position.set(-1.2, 1.2 + trailerHeight / 2, 0);
      body.castShadow = true;
      body.receiveShadow = true;
      this.group.add(body);

      // Rear door frame so the loading face reads clearly.
      const rear = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, trailerHeight * 0.92, trailerWidth * 0.9),
        new THREE.MeshStandardMaterial({
          color: kind === 'reefer' ? 0xcfe6f5 : 0xd7dde5,
          roughness: 0.6,
          metalness: 0.2,
        }),
      );
      rear.position.set(-1.2 - trailerLength / 2 - 0.05, 1.2 + trailerHeight / 2, 0);
      this.group.add(rear);
    }

    const cabX = trailerLength / 2 + 1.1;
    this.cab = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, kind === 'van' ? 2.0 : 2.5, trailerWidth * 0.95),
      new THREE.MeshStandardMaterial({
        color: accent,
        roughness: 0.45,
        metalness: 0.25,
      }),
    );
    this.cab.position.set(cabX, kind === 'van' ? 1.85 : 2.1, 0);
    this.cab.castShadow = true;
    this.group.add(this.cab);

    const windshield = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.85, trailerWidth * 0.8),
      materials.glass,
    );
    windshield.position.set(cabX + 1.24, kind === 'van' ? 2.1 : 2.4, 0);
    this.group.add(windshield);

    const wheelGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.36, 12);
    wheelGeo.rotateX(Math.PI / 2);
    for (const wx of [cabX - 0.6, cabX - 1.9, -trailerLength / 2 - 0.2]) {
      for (const wz of [-trailerWidth / 2 - 0.05, trailerWidth / 2 + 0.05]) {
        const wheel = new THREE.Mesh(wheelGeo, materials.wheel);
        wheel.position.set(wx, 0.52, wz);
        this.group.add(wheel);
      }
    }

    this.beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffc247 }),
    );
    this.beacon.position.set(cabX, kind === 'van' ? 3.0 : 3.5, 0);
    this.group.add(this.beacon);
  }

  update(vehicle: Vehicle, time: number): void {
    this.group.position.set(vehicle.x, 0, vehicle.z);
    this.group.rotation.y = vehicle.rotation;
    const blinking = vehicle.status === 'loading' || vehicle.status === 'enroute';
    this.beacon.visible = blinking;
    if (blinking) {
      this.beacon.material = (this.beacon.material as THREE.MeshBasicMaterial).clone();
      (this.beacon.material as THREE.MeshBasicMaterial).opacity = Math.sin(time * 6) > 0 ? 1 : 0.15;
      (this.beacon.material as THREE.MeshBasicMaterial).transparent = true;
    }
  }
}

/* ---------------------------------------------------------------- workers */

export class WorkerFleet {
  readonly group = new THREE.Group();
  readonly bodies: THREE.InstancedMesh;
  private readonly heads: THREE.InstancedMesh;
  private readonly vests: THREE.InstancedMesh;

  constructor(materials: MaterialKit, workers: Worker[]) {
    const bodyGeo = enableInstanceColor(new THREE.CapsuleGeometry(0.19, 0.5, 4, 8));
    bodyGeo.translate(0, 0.55, 0);
    this.bodies = new THREE.InstancedMesh(bodyGeo, materials.workerInstanced, workers.length);
    this.bodies.castShadow = true;

    const vestGeo = new THREE.BoxGeometry(0.42, 0.3, 0.42);
    vestGeo.translate(0, 0.72, 0);
    this.vests = new THREE.InstancedMesh(
      vestGeo,
      new THREE.MeshStandardMaterial({ color: 0xf5f7fa, roughness: 0.7 }),
      workers.length,
    );

    const headGeo = new THREE.SphereGeometry(0.13, 8, 6);
    headGeo.translate(0, 1.02, 0);
    this.heads = new THREE.InstancedMesh(
      headGeo,
      new THREE.MeshStandardMaterial({ color: 0xe8c39e, roughness: 0.8 }),
      workers.length,
    );

    for (let i = 0; i < workers.length; i++) {
      tmpColor.setHex(
        workers[i]!.role === 'picker'
          ? PALETTE.worker
          : workers[i]!.role === 'packer'
            ? 0x3b82f6
            : workers[i]!.role === 'receiver'
              ? 0x22a05a
              : workers[i]!.role === 'loader'
                ? 0xf97316
                : 0x7c5cd6,
      );
      this.bodies.setColorAt(i, tmpColor);
    }
    this.group.add(this.bodies, this.vests, this.heads);
  }

  update(workers: Worker[]): void {
    for (let i = 0; i < workers.length; i++) {
      const worker = workers[i]!;
      tmpPos.set(worker.x, 0, worker.z);
      tmpQuat.setFromEuler(new THREE.Euler(0, worker.rotation, 0));
      tmpScale.set(1, 1, 1);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      this.bodies.setMatrixAt(i, tmpMatrix);
      this.vests.setMatrixAt(i, tmpMatrix);
      this.heads.setMatrixAt(i, tmpMatrix);
    }
    this.bodies.instanceMatrix.needsUpdate = true;
    this.vests.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------- AGVs */

export class AgvFleet {
  readonly group = new THREE.Group();
  private readonly actors: Array<{ root: THREE.Group; fork: THREE.Mesh; beacon: THREE.Mesh }> = [];

  constructor(materials: MaterialKit, agvs: Agv[]) {
    for (const agv of agvs) {
      const root = new THREE.Group();
      const color = agv.kind === 'reach' ? PALETTE.agv : agv.kind === 'tunnel' ? PALETTE.agvAlt : 0xffd166;
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.9, 0.62, 1.05),
        new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.42 }),
      );
      body.position.y = 0.45;
      body.castShadow = true;
      root.add(body);

      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.12, 0.95),
        materials.steelDark,
      );
      deck.position.y = 0.79;
      root.add(deck);

      const mast = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.9, 0.12), materials.steel);
      mast.position.set(-0.95, 1.1, 0.36);
      root.add(mast);
      const mast2 = mast.clone();
      mast2.position.z = -0.36;
      root.add(mast2);

      const fork = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.07, 0.9), materials.steel);
      fork.position.set(-1.5, 0.16, 0);
      root.add(fork);

      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x2f7fd4 }),
      );
      beacon.position.set(0.6, 0.92, 0);
      root.add(beacon);

      const wheelGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.12, 8);
      wheelGeo.rotateX(Math.PI / 2);
      for (const wx of [-0.65, 0.65]) {
        for (const wz of [-0.46, 0.46]) {
          const wheel = new THREE.Mesh(wheelGeo, materials.wheel);
          wheel.position.set(wx, 0.16, wz);
          root.add(wheel);
        }
      }

      this.group.add(root);
      root.userData.pick = { kind: 'agv', id: agv.id };
      this.actors.push({ root, fork, beacon });
    }
  }

  update(agvs: Agv[], time: number): void {
    for (let i = 0; i < agvs.length && i < this.actors.length; i++) {
      const agv = agvs[i]!;
      const actor = this.actors[i]!;
      actor.root.position.set(agv.x, 0, agv.z);
      actor.root.rotation.y = agv.rotation;
      const carrying = agv.state === 'toDrop';
      actor.fork.position.y = carrying ? 0.75 : 0.16;
      (actor.beacon.material as THREE.MeshBasicMaterial).color.setHex(
        agv.battery < 0.2 ? 0xf87171 : agv.state === 'idle' ? 0x4a5563 : 0x35e0d0,
      );
      actor.beacon.scale.setScalar(1 + Math.sin(time * 4 + i) * 0.12);
    }
  }
}
