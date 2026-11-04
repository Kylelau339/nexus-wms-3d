import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { prefersReducedMotion } from '../core/preferences';
import { bindContextRecovery, incidents, LoopGuard } from '../core/resilience';
import type { SimulationEngine } from '../domain/engine';
import type { Location } from '../domain/types';
import { AgvFleet, TruckActor, WorkerFleet } from './actors';
import { createMaterials, type MaterialKit } from './materials';
import { buildPickPath, createMarkerPool, createPathOverlay, type MarkerPool, type PathOverlay } from './overlays';
import { makeSkyTexture } from './textures';
import { buildWarehouse, type WarehouseBuild } from './warehouse';

export type CameraPreset = 'overview' | 'inbound' | 'storage' | 'picking' | 'packing' | 'outbound';

export interface PickResult {
  kind: 'location' | 'vehicle' | 'worker' | 'agv' | 'station' | 'dock' | 'zone';
  id: string;
  point: THREE.Vector3;
}

const PRESETS: Record<CameraPreset, { position: THREE.Vector3; target: THREE.Vector3 }> = {
  overview: { position: new THREE.Vector3(96, 82, 118), target: new THREE.Vector3(0, 0, -2) },
  inbound: { position: new THREE.Vector3(-16, 34, -86), target: new THREE.Vector3(-30, 0, -32) },
  storage: { position: new THREE.Vector3(-30, 46, 58), target: new THREE.Vector3(-28, 2, -4) },
  picking: { position: new THREE.Vector3(2, 24, 24), target: new THREE.Vector3(-8, 2, -6) },
  packing: { position: new THREE.Vector3(-8, 22, 78), target: new THREE.Vector3(-8, 0, 34) },
  outbound: { position: new THREE.Vector3(70, 30, 92), target: new THREE.Vector3(30, 0, 40) },
};

export class WarehouseScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly materials: MaterialKit;

  private warehouse: WarehouseBuild;
  private trucks = new Map<string, TruckActor>();
  private workerFleet: WorkerFleet;
  private agvFleet: AgvFleet;
  private pathOverlay: PathOverlay;
  private markerPool: MarkerPool;
  private lastTime = performance.now();
  private elapsed = 0;
  private engine: SimulationEngine;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private frameTimes: number[] = [];
  private quality = 2;
  private running = true;
  private lastStockUpdate = 0;
  private flight: { from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t: number } | null = null;
  private frameCallbacks: Array<(dt: number, time: number) => void> = [];
  /** True while the GPU context is gone and drawing has to be skipped. */
  private contextLost = false;
  private unbindContext: (() => void) | null = null;
  /** Keeps a failing frame from turning into sixty reports per second. */
  private readonly guard = new LoopGuard({
    log: incidents,
    maxConsecutiveFailures: 30,
    recoverableId: 'loop-error',
    fatalId: 'loop-fatal',
  });

  constructor(canvas: HTMLCanvasElement, engine: SimulationEngine) {
    this.engine = engine;
    this.materials = createMaterials();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = makeSkyTexture();
    this.scene.fog = new THREE.Fog(0xdcecff, 180, 420);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.5, 900);
    this.camera.position.copy(PRESETS.overview.position);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.target.copy(PRESETS.overview.target);
    this.controls.minDistance = 14;
    this.controls.maxDistance = 280;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minPolarAngle = 0.08;
    this.controls.screenSpacePanning = false;

    this.addLights();
    this.addEnvironment();

    this.warehouse = buildWarehouse(engine.layout, this.materials);
    this.scene.add(this.warehouse.group);

    for (const vehicle of engine.vehicles) {
      const accent = ACCENTS[engine.vehicles.indexOf(vehicle) % ACCENTS.length]!;
      const actor = new TruckActor(this.materials, vehicle.kind, accent);
      actor.group.position.set(vehicle.x, 0, vehicle.z);
      actor.group.userData.pick = { kind: 'vehicle', id: vehicle.id };
      this.trucks.set(vehicle.id, actor);
      this.scene.add(actor.group);
    }

    this.workerFleet = new WorkerFleet(this.materials, engine.workers);
    this.scene.add(this.workerFleet.group);

    this.agvFleet = new AgvFleet(this.materials, engine.agvs);
    this.scene.add(this.agvFleet.group);

    this.pathOverlay = createPathOverlay();
    this.scene.add(this.pathOverlay.group);

    this.markerPool = createMarkerPool(80);
    this.scene.add(this.markerPool.group);

    this.warehouse.update(engine.inventory);
    this.resize();
    window.addEventListener('resize', this.resize);

    // A lost GPU context (driver reset, GPU switch, a virtualised host) leaves
    // the canvas blank. Three.js restores its own resources when the browser
    // hands the context back; the application only has to stop drawing and
    // tell the operator what happened.
    this.unbindContext = bindContextRecovery(this.renderer.domElement, {
      onLost: () => {
        this.contextLost = true;
        incidents.report({ id: 'context-lost', severity: 'warning' });
      },
      onRestored: () => {
        this.contextLost = false;
        incidents.report({ id: 'context-restored', severity: 'info' });
      },
    });
  }

  /* ------------------------------------------------------------- setup */

  private addLights(): void {
    const hemi = new THREE.HemisphereLight(0xffffff, 0xd6e4f2, 1.45);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfffaf2, 1.95);
    sun.position.set(72, 108, 58);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.near = 40;
    sun.shadow.camera.far = 280;
    sun.shadow.camera.left = -95;
    sun.shadow.camera.right = 95;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun);
    this.scene.add(sun.target);
    sun.target.position.set(0, 0, 0);

    const fill = new THREE.DirectionalLight(0xbcd8f5, 0.55);
    fill.position.set(-80, 60, -70);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0x8fc4ff, 0.22);
    rim.position.set(0, 30, -120);
    this.scene.add(rim);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  }

  private addEnvironment(): void {
    const grid = new THREE.GridHelper(380, 76, 0xc3d6ea, 0xdde8f3);
    grid.position.set(10, -0.04, 0);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.6;
    this.scene.add(grid);

    // Yard road surface so trucks have a visible route.
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(360, 26),
      new THREE.MeshStandardMaterial({ color: 0xd8e2ee, roughness: 0.98 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(10, -0.03, 52);
    this.scene.add(road);

    const roadNorth = road.clone();
    roadNorth.position.set(10, -0.03, -52);
    this.scene.add(roadNorth);
  }

  /* ------------------------------------------------------------ resize */

  private resize = (): void => {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  /* ---------------------------------------------------------- picking */

  /** Convert a pointer event into a domain selection. */
  pick(event: PointerEvent): PickResult | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    for (const hit of hits) {
      const object = hit.object;
      // Cartons and pallets map directly back to their storage location.
      if (
        (object === this.warehouse.cartons || object === this.warehouse.pallets) &&
        hit.instanceId !== undefined
      ) {
        const locId = this.warehouse.cartonLocationIds[hit.instanceId];
        if (locId) return { kind: 'location', id: locId, point: hit.point.clone() };
      }
      if (object === this.workerFleet.bodies && hit.instanceId !== undefined) {
        const worker = this.engine.workers[hit.instanceId];
        if (worker) return { kind: 'worker', id: worker.id, point: hit.point.clone() };
      }
      const tag = findTag(object);
      if (tag) {
        return { kind: tag.kind, id: tag.id, point: hit.point.clone() };
      }
    }

    const bin = this.pickBin();
    if (bin) {
      return { kind: 'location', id: bin.id, point: new THREE.Vector3(bin.x, bin.y, bin.z) };
    }
    return null;
  }

  /**
   * Analytic rack picking: intersect the pointer ray with each rack's front
   * face and resolve the bin from the hit point. Cheaper and more precise than
   * raycasting thousands of instanced pallets.
   */
  private pickBin(): Location | null {
    const ray = this.raycaster.ray;
    const candidates: Array<{ loc: Location; distance: number }> = [];

    for (const rack of this.engine.layout.racks) {
      const planeZ = rack.z + rack.depth / 2;
      if (Math.abs(ray.direction.z) < 1e-6) continue;
      const t = (planeZ - ray.origin.z) / ray.direction.z;
      if (t <= 0) continue;
      const point = ray.at(t, new THREE.Vector3());
      if (point.x < rack.startX || point.x > rack.endX) continue;
      if (point.y < 0 || point.y > rack.levels * rack.levelHeight + 0.6) continue;
      const bay = Math.min(rack.bays, Math.max(1, Math.floor((point.x - rack.startX) / rack.bayWidth) + 1));
      const level = Math.min(rack.levels, Math.max(1, Math.floor((point.y - 0.1) / rack.levelHeight) + 1));
      const id = `${rack.zoneId}-${String(rack.row).padStart(2, '0')}-${String(bay).padStart(3, '0')}-${level}`;
      const loc = this.engine.layout.locations.get(id);
      if (loc) candidates.push({ loc, distance: t });
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => a.distance - b.distance);
      return candidates[0]!.loc;
    }

    // Floor pick → nearest staging location.
    if (Math.abs(ray.direction.y) > 1e-6) {
      const t = -ray.origin.y / ray.direction.y;
      if (t > 0) {
        const point = ray.at(t, new THREE.Vector3());
        let best: Location | null = null;
        let bestDist = 2.6;
        for (const loc of this.engine.layout.locations.values()) {
          if (loc.kind !== 'staging') continue;
          const d = Math.hypot(loc.x - point.x, loc.z - point.z);
          if (d < bestDist) {
            bestDist = d;
            best = loc;
          }
        }
        if (best) return best;
      }
    }
    return null;
  }

  /* --------------------------------------------------------- highlight */

  setHighlight(locations: Location[], color = 0x35e0d0): void {
    const points = locations.map((l) => new THREE.Vector3(l.x, 0.06, l.z));
    this.markerPool.setMarkers(points, color);
  }

  setPath(locations: Location[]): void {
    this.pathOverlay.setPath(buildPickPath(locations));
  }

  clearPath(): void {
    this.pathOverlay.setPath([]);
  }

  /** Redraw the in-scene sign boards after an interface language change. */
  refreshLabels(): void {
    this.warehouse.refreshLabels();
  }

  /* ----------------------------------------------------------- camera */

  setPreset(preset: CameraPreset): void {
    const p = PRESETS[preset];
    this.flyTo(p.position, p.target);
  }

  focusLocation(location: Location, distance = 26): void {
    const target = new THREE.Vector3(location.x, location.y + 1, location.z);
    const dir = new THREE.Vector3(0.55, 0.62, 0.78).normalize();
    this.flyTo(target.clone().add(dir.multiplyScalar(distance)), target);
  }

  focusPoint(point: THREE.Vector3, distance = 30): void {
    const dir = new THREE.Vector3(0.5, 0.65, 0.8).normalize();
    this.flyTo(point.clone().add(dir.multiplyScalar(distance)), point.clone());
  }

  private flyTo(position: THREE.Vector3, target: THREE.Vector3): void {
    // The flight is a decorative transition, so it is skipped when the operator
    // asked the system to reduce motion.
    if (prefersReducedMotion()) {
      this.flight = null;
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }

    this.flight = {
      from: this.camera.position.clone(),
      to: position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
      t: 0,
    };
  }

  /* ------------------------------------------------------------- loop */

  onFrame(cb: (dt: number, time: number) => void): void {
    this.frameCallbacks.push(cb);
  }

  start(): void {
    const loop = () => {
      // A dead loop stops scheduling itself: retrying forever would only
      // fill the console with the same failure over and over.
      if (!this.running || !this.guard.healthy) return;
      requestAnimationFrame(loop);
      this.guard.run(() => this.frame());
    };
    requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.elapsed += dt;
    const time = this.elapsed;

    // While the GPU context is gone there is nothing to draw, but the
    // simulation keeps running so the 2D panels stay live and useful.
    if (!this.contextLost) this.updateScene(dt, time);

    for (const cb of this.frameCallbacks) cb(dt, time);

    if (!this.contextLost) {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    }

    this.trackPerformance(dt);
  }

  /** Everything that only makes sense while the scene can actually be drawn. */
  private updateScene(dt: number, time: number): void {
    // Camera flight
    if (this.flight) {
      this.flight.t = Math.min(1, this.flight.t + dt / 0.85);
      const e = 1 - Math.pow(1 - this.flight.t, 3);
      this.camera.position.lerpVectors(this.flight.from, this.flight.to, e);
      this.controls.target.lerpVectors(this.flight.fromTarget, this.flight.toTarget, e);
      if (this.flight.t >= 1) this.flight = null;
    }

    // Engine-driven actors
    for (const vehicle of this.engine.vehicles) {
      this.trucks.get(vehicle.id)?.update(vehicle, time);
    }
    this.workerFleet.update(this.engine.workers);
    this.agvFleet.update(this.engine.agvs, time);
    this.pathOverlay.update(time);
    this.markerPool.update(time);

    // Stock refresh at ~2 Hz
    if (time - this.lastStockUpdate > 0.5) {
      this.lastStockUpdate = time;
      this.warehouse.update(this.engine.inventory);
    }

    // Dock beacons react to occupancy (emissive, no extra light cost).
    const docks = this.engine.layout.docks;
    for (let i = 0; i < docks.length; i++) {
      const dock = docks[i]!;
      const beacon = this.warehouse.dockBeacons[i];
      if (!beacon) continue;
      const material = beacon.material as THREE.MeshBasicMaterial;
      const target = dock.occupiedBy ? 0.85 : 0.12;
      material.opacity += (target - material.opacity) * 0.08;
    }
  }

  /** Adaptive quality: drop pixel ratio, then shadows, if the frame rate collapses. */
  private trackPerformance(dt: number): void {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 60) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    const fps = 1 / Math.max(0.001, avg);
    if (fps < 32 && this.quality === 2) {
      this.quality = 1;
      this.renderer.setPixelRatio(1);
    } else if (fps < 22 && this.quality === 1) {
      this.quality = 0;
      this.renderer.shadowMap.enabled = false;
      this.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) mesh.castShadow = false;
      });
    }
  }

  dispose(): void {
    this.running = false;
    window.removeEventListener('resize', this.resize);
    this.unbindContext?.();
    this.unbindContext = null;
    this.controls.dispose();
    this.renderer.dispose();
  }
}

const ACCENTS = [0x35e0d0, 0xffb347, 0x6aa6ff, 0x4ade80, 0xff6b6b, 0xa78bfa];

interface PickTag {
  kind: PickResult['kind'];
  id: string;
}

function findTag(object: THREE.Object3D | null): PickTag | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const data = current.userData as { pick?: PickTag };
    if (data.pick) return data.pick;
    current = current.parent;
  }
  return null;
}
