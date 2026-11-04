import type { Rng } from '../core/rng';
import type { Agv, Worker } from './types';

const SURNAMES = ['陳', '林', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊', '許', '鄭', '謝', '洪', '周', '葉'];
const GIVEN = ['志豪', '雅婷', '建宏', '欣怡', '宗翰', '詩涵', '家豪', '筱雯', '明哲', '思妤', '冠廷', '惠敏', '柏翰', '若涵', '子豪', '品妘'];

export function buildWorkers(rng: Rng, count = 28): Worker[] {
  const workers: Worker[] = [];
  const roles: Worker['role'][] = [
    'picker', 'picker', 'picker', 'picker', 'picker', 'picker', 'picker', 'picker',
    'picker', 'picker', 'picker', 'picker',
    'receiver', 'receiver', 'receiver', 'receiver',
    'packer', 'packer', 'packer', 'packer', 'packer', 'packer',
    'loader', 'loader', 'loader',
    'driver', 'driver',
    'supervisor', 'supervisor',
  ];
  for (let i = 0; i < count; i++) {
    const role = roles[i % roles.length]!;
    workers.push({
      id: `W-${String(i + 1).padStart(3, '0')}`,
      name: `${rng.pick(SURNAMES)}${rng.pick(GIVEN)}`,
      role,
      skill: Number(rng.float(0.94, 1).toFixed(3)),
      locationId: null,
      zoneId: null,
      x: rng.float(-40, 40),
      z: rng.float(-26, 28),
      rotation: 0,
      busyTaskId: null,
      picksPerHour: Number(rng.float(48, 132).toFixed(1)),
      utilisation: 0,
    });
  }
  return workers;
}

export function buildAgvs(rng: Rng, count = 10): Agv[] {
  const agvs: Agv[] = [];
  for (let i = 0; i < count; i++) {
    agvs.push({
      id: `AGV-${String(i + 1).padStart(2, '0')}`,
      kind: i < 4 ? 'reach' : i < 8 ? 'tunnel' : 'counterbalance',
      x: rng.float(-50, 50),
      z: rng.float(-20, 22),
      rotation: 0,
      state: 'idle',
      taskId: null,
      busyTaskId: null,
      battery: rng.float(0.55, 1),
      payloadSku: null,
      speed: 0,
    });
  }
  return agvs;
}

/** Yard road waypoints (world metres) used to animate trucks on/off site. */
export const YARD_ROUTES = {
  /** Inbound truck: gate → yard → assigned inbound dock. */
  inbound: (dockX: number): Array<[number, number]> => [
    [112, 6],
    [96, -14],
    [82, -40],
    [70, -52],
    [dockX, -52],
    [dockX, -46.2],
  ],
  /** Outbound truck: dock → yard → gate. */
  outbound: (dockX: number): Array<[number, number]> => [
    [dockX, -46.2],
    [dockX, -52],
    [70, -52],
    [82, -40],
    [96, -14],
    [112, 6],
  ],
  /** Inbound truck that has been released and heads to its dock from the west gate. */
  inboundWest: (dockX: number): Array<[number, number]> => [
    [-112, -6],
    [-96, -18],
    [-82, -42],
    [-70, -52],
    [dockX, -52],
    [dockX, -46.2],
  ],
  /** Outbound truck leaving through the east gate. */
  outboundEast: (dockX: number): Array<[number, number]> => [
    [dockX, 46.2],
    [dockX, 52],
    [74, 52],
    [86, 34],
    [100, 12],
    [116, 2],
  ],
};
