import * as THREE from 'three';
import { t } from '../core/i18n';
import type { Inventory } from '../domain/inventory';
import { zoneName } from '../domain/labels';
import type { WarehouseLayout } from '../domain/layout';
import type { Location } from '../domain/types';
import { PALETTE, SHELL_HEIGHT, enableInstanceColor, type MaterialKit } from './materials';
import {
  makeFloorTexture,
  makeGlowTexture,
  makeSignTexture,
  makeTagTexture,
  type SignOptions,
} from './textures';

export interface WarehouseBuild {
  group: THREE.Group;
  pallets: THREE.InstancedMesh;
  cartons: THREE.InstancedMesh;
  /** Maps a carton instance index back to the storage location it represents. */
  cartonLocationIds: string[];
  locationPoints: Map<string, THREE.Vector3>;
  /** Emissive beacons at each dock — no real lights, they stay cheap. */
  dockBeacons: THREE.Mesh[];
  update(inventory: Inventory): void;
  /** Redraw the in-scene sign boards in the active language. */
  refreshLabels(): void;
}

/** A sign board whose caption depends on the active language. */
interface LabelSpec {
  sprite: THREE.Sprite;
  options: () => SignOptions;
}

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3(1, 1, 1);
const tmpColor = new THREE.Color();

export function buildWarehouse(
  layout: WarehouseLayout,
  materials: MaterialKit,
): WarehouseBuild {
  const group = new THREE.Group();
  group.name = 'warehouse';
  const locationPoints = new Map<string, THREE.Vector3>();
  const labels: LabelSpec[] = [];

  const bounds = layout.bounds;
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;

  /* ------------------------------------------------------------ ground */
  const yard = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 340),
    new THREE.MeshStandardMaterial({ color: 0xe3ebf4, roughness: 1, metalness: 0 }),
  );
  yard.rotation.x = -Math.PI / 2;
  yard.position.set(10, -0.06, 0);
  yard.receiveShadow = true;
  group.add(yard);

  const floorMaterial = materials.floor.clone();
  floorMaterial.map = makeFloorTexture();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(centerX, 0, centerZ);
  floor.receiveShadow = true;
  group.add(floor);

  // Painted floor border marking the building envelope.
  const border = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.5, 4),
    materials.hazard,
  );
  border.visible = false;
  group.add(border);

  /* -------------------------------------------------------------- zones */
  for (const zone of layout.zones) {
    const w = zone.maxX - zone.minX;
    const d = zone.maxZ - zone.minZ;
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(w, d), materials.zonePatch.clone());
    (patch.material as THREE.MeshBasicMaterial).color = new THREE.Color(zone.color);
    (patch.material as THREE.MeshBasicMaterial).opacity = 0.075;
    patch.rotation.x = -Math.PI / 2;
    patch.position.set((zone.minX + zone.maxX) / 2, 0.015, (zone.minZ + zone.maxZ) / 2);
    group.add(patch);

    // Zone outline
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, d)),
      new THREE.LineBasicMaterial({ color: zone.color, transparent: true, opacity: 0.55 }),
    );
    outline.rotation.x = -Math.PI / 2;
    outline.position.copy(patch.position);
    outline.position.y = 0.02;
    group.add(outline);

    // Sign board
    const zoneLabelOptions = (): SignOptions => {
      const name = zoneName(zone);
      return {
        text: t('{0} 區', zone.id),
        sub: name.split('·')[1]?.trim() ?? name,
        color: `#${new THREE.Color(zone.color).getHexString()}`,
      };
    };
    const sign = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeSignTexture(zoneLabelOptions()),
        depthTest: false,
        transparent: true,
      }),
    );
    labels.push({ sprite: sign, options: zoneLabelOptions });
    sign.scale.set(13, 4, 1);
    sign.position.set(zone.minX + 4, 6.2, zone.minZ - 1.4);
    sign.renderOrder = 5;
    group.add(sign);
  }

  /* -------------------------------------------------------------- walls */
  const wallHeight = SHELL_HEIGHT;
  const wallThickness = 0.5;

  const inboundDoors = layout.docks
    .filter((d) => d.kind === 'inbound')
    .map((d) => ({ center: d.x, width: d.doorWidth }));
  const outboundDoors = layout.docks
    .filter((d) => d.kind === 'outbound')
    .map((d) => ({ center: d.x, width: d.doorWidth }));

  buildWall(group, materials.wall, 'z', bounds.minZ, bounds.minX, bounds.maxX, wallHeight, inboundDoors, wallThickness);
  buildWall(group, materials.wall, 'z', bounds.maxZ, bounds.minX, bounds.maxX, wallHeight, outboundDoors, wallThickness);
  buildWall(group, materials.wall, 'x', bounds.minX, bounds.minZ, bounds.maxZ, wallHeight, [], wallThickness);
  buildWall(group, materials.wall, 'x', bounds.maxX, bounds.minZ, bounds.maxZ, wallHeight, [], wallThickness);

  // Cold-room partitions (chilled + frozen enclosures).
  const partition = (x: number, zFrom: number, zTo: number) => {
    const len = zTo - zFrom;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 5.2, len),
      new THREE.MeshStandardMaterial({ color: 0xcddcee, roughness: 0.85, metalness: 0.08 }),
    );
    mesh.position.set(x, 2.6, (zFrom + zTo) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  partition(9.5, -22, -4);
  partition(37, -22, -4);
  partition(9.5, -4, 18);
  partition(37, -4, 18);

  /* -------------------------------------------------------------- docks */
  const dockBeacons: THREE.Mesh[] = [];
  for (const dock of layout.docks) {
    const isInbound = dock.kind === 'inbound';
    const z = dock.z + (isInbound ? -0.3 : 0.3);

    const frame = new THREE.Group();
    const postGeo = new THREE.BoxGeometry(0.45, 5, 0.6);
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(dock.doorWidth + 1.2, 0.8, 0.7),
      materials.steelDark,
    );
    lintel.position.set(0, 5, 0);
    frame.add(lintel);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, materials.steelDark);
      post.position.set(side * (dock.doorWidth / 2 + 0.3), 2.5, 0);
      post.castShadow = true;
      frame.add(post);
    }
    // Roller shutter
    const shutter = new THREE.Mesh(
      new THREE.BoxGeometry(dock.doorWidth, 4.2, 0.16),
      materials.steel,
    );
    shutter.position.set(0, 2.4, isInbound ? 0.12 : -0.12);
    frame.add(shutter);

    // Dock leveller plate
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(dock.doorWidth, 0.18, 2.4),
      materials.steel,
    );
    plate.position.set(0, 0.09, isInbound ? -1.2 : 1.2);
    plate.receiveShadow = true;
    frame.add(plate);

    // Hazard stripes beside the door
    for (const side of [-1, 1]) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.05, 2.4),
        materials.hazard,
      );
      stripe.position.set(side * (dock.doorWidth / 2 + 0.7), 0.05, isInbound ? -1.2 : 1.2);
      frame.add(stripe);
    }

    frame.position.set(dock.x, 0, z);
    frame.userData.pick = { kind: 'dock', id: dock.id };
    group.add(frame);

    const tag = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeTagTexture(dock.id, isInbound ? '#35e0d0' : '#ffb347'),
        depthTest: false,
        transparent: true,
      }),
    );
    tag.scale.set(5, 1.25, 1);
    tag.position.set(dock.x, 6.2, z + (isInbound ? -1 : 1));
    tag.renderOrder = 5;
    group.add(tag);

    const light = new THREE.Mesh(
      new THREE.PlaneGeometry(5.4, 5.4),
      new THREE.MeshBasicMaterial({
        map: makeGlowTexture(isInbound ? '#276bb9' : '#b05c00'),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.NormalBlending,
      }),
    );
    light.rotation.x = -Math.PI / 2;
    light.position.set(dock.x, 0.08, z + (isInbound ? -2.6 : 2.6));
    group.add(light);
    dockBeacons.push(light);
  }

  /* -------------------------------------------------------------- racking */
  let uprightCount = 0;
  let beamCount = 0;
  let palletSlots = 0;
  for (const rack of layout.racks) {
    uprightCount += rack.bays + 1;
    beamCount += rack.bays * rack.levels * 2;
  }
  for (const loc of layout.locations.values()) if (loc.palletPosition) palletSlots++;

  const uprightGeo = new THREE.BoxGeometry(0.14, 1, 1);
  const uprights = new THREE.InstancedMesh(uprightGeo, materials.upright, uprightCount);
  uprights.castShadow = true;
  uprights.receiveShadow = true;

  const beamGeo = new THREE.BoxGeometry(1, 0.12, 0.1);
  const beams = new THREE.InstancedMesh(beamGeo, materials.beam, beamCount);
  beams.castShadow = true;

  let uIndex = 0;
  let bIndex = 0;
  for (const rack of layout.racks) {
    const totalHeight = rack.levels * rack.levelHeight + 0.5;
    for (let i = 0; i <= rack.bays; i++) {
      tmpPos.set(rack.startX + i * rack.bayWidth, totalHeight / 2, rack.z);
      tmpScale.set(1, totalHeight, rack.depth);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      uprights.setMatrixAt(uIndex++, tmpMatrix);
    }
    for (let level = 0; level < rack.levels; level++) {
      const y = 0.22 + level * rack.levelHeight - 0.12;
      for (let bay = 0; bay < rack.bays; bay++) {
        const x = rack.startX + (bay + 0.5) * rack.bayWidth;
        for (const side of [-1, 1]) {
          tmpPos.set(x, y, rack.z + side * (rack.depth / 2 - 0.05));
          tmpScale.set(rack.bayWidth - 0.14, 1, 1);
          tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
          beams.setMatrixAt(bIndex++, tmpMatrix);
        }
      }
    }
  }
  uprights.instanceMatrix.needsUpdate = true;
  beams.instanceMatrix.needsUpdate = true;
  group.add(uprights, beams);

  // Pallets + cartons, one instance per storage location.
  const palletGeo = enableInstanceColor(new THREE.BoxGeometry(1, 0.14, 0.92));
  const pallets = new THREE.InstancedMesh(palletGeo, materials.palletInstanced, palletSlots);
  pallets.castShadow = true;
  pallets.receiveShadow = true;
  pallets.count = 0;

  const cartonGeo = enableInstanceColor(new THREE.BoxGeometry(0.86, 1, 0.78));
  const cartons = new THREE.InstancedMesh(cartonGeo, materials.palletInstanced, palletSlots);
  cartons.castShadow = true;
  cartons.count = 0;
  group.add(pallets, cartons);

  /** Parallel array mapping carton instance index → location id. */
  const cartonLocationIds: string[] = [];

  for (const loc of layout.locations.values()) {
    if (!loc.palletPosition) continue;
    locationPoints.set(loc.id, new THREE.Vector3(loc.x, loc.y + 0.1, loc.z));
  }

  /* ----------------------------------------------------------- stations */
  for (const station of layout.stations) {
    const group2 = new THREE.Group();
    switch (station.kind) {
      case 'packing': {
        const bench = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.16, 1.3), materials.conveyor);
        bench.position.y = 0.95;
        bench.castShadow = true;
        group2.add(bench);
        for (const sx of [-1.4, 1.4]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.95, 1.1), materials.steelDark);
          leg.position.set(sx, 0.47, 0);
          group2.add(leg);
        }
        const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.06), materials.machine);
        monitor.position.set(1.2, 1.3, 0.5);
        monitor.rotation.x = -0.3;
        group2.add(monitor);
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.45), materials.carton);
        box.position.set(-0.8, 1.23, 0.1);
        box.castShadow = true;
        group2.add(box);
        break;
      }
      case 'receiving': {
        const table = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.18, 1.6), materials.conveyor);
        table.position.y = 0.9;
        table.castShadow = true;
        group2.add(table);
        for (const sx of [-1.6, 1.6]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 1.4), materials.steelDark);
          leg.position.set(sx, 0.45, 0);
          group2.add(leg);
        }
        const scanner = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.3), materials.machine);
        scanner.position.set(0, 1.35, 0);
        group2.add(scanner);
        const scanGlow = new THREE.Mesh(
          new THREE.PlaneGeometry(2.6, 2.6),
          new THREE.MeshBasicMaterial({
            map: makeGlowTexture('#e08a1e'),
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
            blending: THREE.NormalBlending,
          }),
        );
        scanGlow.rotation.x = -Math.PI / 2;
        scanGlow.position.set(0, 0.06, 0);
        group2.add(scanGlow);
        break;
      }
      case 'qc': {
        const table = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 1.4), materials.machine);
        table.position.y = 0.45;
        table.castShadow = true;
        group2.add(table);
        const qcGlow = new THREE.Mesh(
          new THREE.PlaneGeometry(2.2, 2.2),
          new THREE.MeshBasicMaterial({
            map: makeGlowTexture('#4f9de0'),
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
            blending: THREE.NormalBlending,
          }),
        );
        qcGlow.rotation.x = -Math.PI / 2;
        qcGlow.position.y = 0.06;
        group2.add(qcGlow);
        break;
      }
      case 'charging': {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 0.4), materials.machine);
        post.position.y = 0.75;
        group2.add(post);
        const cable = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.9), materials.steelDark);
        cable.position.set(0, 0.2, -0.6);
        group2.add(cable);
        const glow = new THREE.Mesh(
          new THREE.PlaneGeometry(0.8, 0.8),
          new THREE.MeshBasicMaterial({
            map: makeGlowTexture('#4ade80'),
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = 0.03;
        group2.add(glow);
        break;
      }
      case 'crossdock': {
        const pad = new THREE.Mesh(
          new THREE.BoxGeometry(8, 0.03, 5),
          new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.16 }),
        );
        pad.position.y = 0.02;
        group2.add(pad);
        break;
      }
    }
    group2.position.set(station.x, 0, station.z);
    group2.rotation.y = station.rotation;
    group2.userData.pick = { kind: 'station', id: station.id };
    group.add(group2);
  }

  /* ----------------------------------------------------------- conveyors */
  const conveyor = new THREE.Group();
  const spineZ = 21.5;
  const spineFrom = -30;
  const spineTo = 34;
  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(spineTo - spineFrom, 0.16, 1.0),
    materials.conveyor,
  );
  belt.position.set((spineFrom + spineTo) / 2, 0.85, spineZ);
  belt.castShadow = true;
  conveyor.add(belt);
  const railGeo = new THREE.BoxGeometry(spineTo - spineFrom, 0.1, 0.08);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, materials.steel);
    rail.position.set((spineFrom + spineTo) / 2, 0.96, spineZ + side * 0.52);
    conveyor.add(rail);
  }
  for (let x = spineFrom; x <= spineTo; x += 4) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.85, 0.9), materials.steelDark);
    leg.position.set(x, 0.42, spineZ);
    conveyor.add(leg);
  }
  group.add(conveyor);

  // Overhead light strips (reads as a lit industrial ceiling from above).
  const lightGeo = new THREE.PlaneGeometry(5.4, 0.5);
  const lights = new THREE.InstancedMesh(lightGeo, materials.emissive, 80);
  let li = 0;
  for (let x = -52; x <= 52 && li < 80; x += 13) {
    for (let z = -30; z <= 30 && li < 80; z += 12) {
      tmpPos.set(x, SHELL_HEIGHT - 0.4, z);
      tmpQuat.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      tmpScale.set(1, 1, 1);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      lights.setMatrixAt(li++, tmpMatrix);
    }
  }
  lights.count = li;
  group.add(lights);

  /* ------------------------------------------------- office & amenities */
  buildOfficeBlock(group, materials, labels);
  buildChargingCanopy(group, materials, layout);
  buildWalkway(group, materials);

  /* ----------------------------------------------------- staging markers */
  for (const loc of layout.locations.values()) {
    if (loc.kind !== 'staging') continue;
    const marker = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 2.2),
      new THREE.MeshBasicMaterial({
        color: loc.zoneId === 'S' ? 0x35e0d0 : 0xffb347,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(loc.x, 0.012, loc.z);
    group.add(marker);
  }

  /* ------------------------------------------------------------- update */
  const palletLocations: Location[] = [];
  for (const loc of layout.locations.values()) if (loc.palletPosition) palletLocations.push(loc);

  function update(inventory: Inventory): void {
    let p = 0;
    let c = 0;
    cartonLocationIds.length = 0;
    for (const loc of palletLocations) {
      const weight = inventory.locationWeight(loc.id);
      if (weight <= 0) continue;
      const utilisation = Math.min(1, weight / loc.maxWeight);

      tmpPos.set(loc.x, loc.y + 0.07, loc.z);
      tmpScale.set(1, 1, 1);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      pallets.setMatrixAt(p, tmpMatrix);
      const shade = 0.72 + utilisation * 0.45;
      tmpColor.setHex(loc.tempZone === 'ambient' ? PALETTE.pallet : PALETTE.cold).multiplyScalar(shade);
      pallets.setColorAt(p, tmpColor);
      p++;

      const height = 0.45 + utilisation * 1.05;
      tmpPos.set(loc.x, loc.y + 0.14 + height / 2, loc.z);
      tmpScale.set(1, height, 1);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      cartons.setMatrixAt(c, tmpMatrix);
      const base =
        loc.tempZone === 'frozen'
          ? PALETTE.cold
          : loc.tempZone === 'chilled'
            ? 0xbfe3d0
            : PALETTE.carton;
      tmpColor.setHex(base).multiplyScalar(0.68 + utilisation * 0.5);
      cartons.setColorAt(c, tmpColor);
      cartonLocationIds[c] = loc.id;
      c++;
    }
    pallets.count = p;
    cartons.count = c;
    pallets.instanceMatrix.needsUpdate = true;
    cartons.instanceMatrix.needsUpdate = true;
    if (pallets.instanceColor) pallets.instanceColor.needsUpdate = true;
    if (cartons.instanceColor) cartons.instanceColor.needsUpdate = true;
  }

  return {
    group,
    pallets,
    cartons,
    cartonLocationIds,
    locationPoints,
    dockBeacons,
    update,
    refreshLabels() {
      for (const label of labels) {
        const material = label.sprite.material as THREE.SpriteMaterial;
        const previous = material.map;
        material.map = makeSignTexture(label.options());
        material.needsUpdate = true;
        previous?.dispose();
      }
    },
  };
}

/** Two-storey WMS control room in the south-west corner. */
function buildOfficeBlock(
  parent: THREE.Group,
  materials: MaterialKit,
  labels: LabelSpec[],
): void {
  const office = new THREE.Group();
  const width = 22;
  const depth = 12;
  const height = 7.2;

  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color: 0xdde8f4, roughness: 0.82, metalness: 0.06 }),
  );
  shell.position.y = height / 2;
  shell.castShadow = true;
  shell.receiveShadow = true;
  office.add(shell);

  // Glazed band so the control room reads as a room, not a slab.
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.08, 2.2, depth + 0.08),
    materials.glass,
  );
  glass.position.y = 4.4;
  office.add(glass);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(width + 1.2, 0.4, depth + 1.2),
    materials.steelDark,
  );
  roof.position.y = height + 0.2;
  roof.castShadow = true;
  office.add(roof);

  // Rooftop HVAC units.
  for (const dx of [-5, 3]) {
    const unit = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.3, 2.6), materials.machine);
    unit.position.set(dx, height + 1.05, 0);
    unit.castShadow = true;
    office.add(unit);
  }

  const sign = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeSignTexture({
        text: t('WMS 控制中心'),
        sub: 'Control Tower · DC-07',
        color: '#6aa6ff',
      }),
      depthTest: false,
      transparent: true,
    }),
  );
  labels.push({
    sprite: sign,
    options: () => ({
      text: t('WMS 控制中心'),
      sub: 'Control Tower · DC-07',
      color: '#6aa6ff',
    }),
  });
  sign.scale.set(13, 4, 1);
  sign.position.set(0, height + 3.4, depth / 2 + 0.4);
  sign.renderOrder = 5;
  office.add(sign);

  const light = new THREE.PointLight(0x8fc4ff, 2.2, 26, 2);
  light.position.set(0, height + 1.4, 0);
  office.add(light);
  const officeGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 8),
    new THREE.MeshBasicMaterial({
      map: makeGlowTexture('#4f9de0'),
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.NormalBlending,
    }),
  );
  officeGlow.rotation.x = -Math.PI / 2;
  officeGlow.position.set(0, 0.06, depth / 2 + 3);
  office.add(officeGlow);

  office.position.set(-46, 0, 34);
  parent.add(office);
}

/** Canopy over the AGV / forklift charging bay. */
function buildChargingCanopy(
  parent: THREE.Group,
  materials: MaterialKit,
  layout: WarehouseLayout,
): void {
  const chargers = layout.stations.filter((s) => s.kind === 'charging');
  if (chargers.length === 0) return;
  const cx = chargers.reduce((s, c) => s + c.x, 0) / chargers.length;
  const cz = chargers.reduce((s, c) => s + c.z, 0) / chargers.length;

  const canopy = new THREE.Group();
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(9, 0.3, 12),
    new THREE.MeshStandardMaterial({ color: 0xb9c7d8, roughness: 0.7, metalness: 0.3 }),
  );
  roof.position.y = 4.6;
  roof.castShadow = true;
  canopy.add(roof);

  for (const sx of [-4, 4]) {
    for (const sz of [-5, 5]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 4.5, 0.28), materials.steel);
      post.position.set(sx, 2.25, sz);
      post.castShadow = true;
      canopy.add(post);
    }
  }
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 11),
    new THREE.MeshBasicMaterial({ color: 0x9fe8c0, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }),
  );
  strip.rotation.x = -Math.PI / 2;
  strip.position.y = 4.4;
  canopy.add(strip);

  canopy.position.set(cx, 0, cz);
  parent.add(canopy);
}

/** Painted pedestrian walkway linking the control room, packing area and docks. */
function buildWalkway(parent: THREE.Group, materials: MaterialKit): void {
  const walkway = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 74),
    new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  walkway.rotation.x = -Math.PI / 2;
  walkway.position.set(-30, 0.014, 6);
  parent.add(walkway);

  const crosswalk = new THREE.Mesh(
    new THREE.PlaneGeometry(92, 2.2),
    new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.18, depthWrite: false }),
  );
  crosswalk.rotation.x = -Math.PI / 2;
  crosswalk.position.set(0, 0.014, 17.5);
  parent.add(crosswalk);
  void materials;
}

/** Build a wall with rectangular openings for dock doors. */
function buildWall(
  parent: THREE.Group,
  material: THREE.Material,
  axis: 'x' | 'z',
  fixed: number,
  from: number,
  to: number,
  height: number,
  doors: Array<{ center: number; width: number }>,
  thickness: number,
): void {
  const doorHeight = 4.6;
  const sorted = [...doors].sort((a, b) => a.center - b.center);
  let cursor = from;

  const makeBox = (a: number, b: number, yFrom: number, yTo: number) => {
    const len = b - a;
    const h = yTo - yFrom;
    if (len <= 0.01 || h <= 0.01) return;
    const geo =
      axis === 'z'
        ? new THREE.BoxGeometry(len, h, thickness)
        : new THREE.BoxGeometry(thickness, h, len);
    const mesh = new THREE.Mesh(geo, material);
    const mid = (a + b) / 2;
    if (axis === 'z') mesh.position.set(mid, (yFrom + yTo) / 2, fixed);
    else mesh.position.set(fixed, (yFrom + yTo) / 2, mid);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
  };

  for (const door of sorted) {
    const left = door.center - door.width / 2;
    const right = door.center + door.width / 2;
    makeBox(cursor, left, 0, height);
    makeBox(left, right, doorHeight, height);
    cursor = right;
  }
  makeBox(cursor, to, 0, height);
}
