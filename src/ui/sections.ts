import { labelTable, localize, renderMessage, t } from '../core/i18n';
import type { SimulationEngine } from '../domain/engine';
import { formatDay, formatMinutes } from '../domain/engine';
import { skuCategory, skuName } from '../domain/labels';
import type { Order, Task } from '../domain/types';
import { drawBars, drawDonut, drawRouteStrip, drawSparkline } from './charts';
import {
  CHANNEL_LABEL,
  esc,
  fmt1,
  fmt2,
  fmtEta,
  fmtInt,
  fmtMoney,
  fmtWeight,
  MOVEMENT_LABEL,
  ORDER_STATUS_LABEL,
  PRIORITY_LABEL,
  ROLE_LABEL,
  SHIPMENT_STATUS,
  statusTone,
  TASK_LABEL,
  VEHICLE_KIND,
  VEHICLE_STATUS_LABEL,
  WAVE_STATUS,
} from './dom';

export type SectionId = 'overview' | 'inbound' | 'inventory' | 'orders' | 'tasks' | 'transport';

export interface UiFilters {
  zone: string;
  search: string;
  taskKind: string;
  orderStatus: string;
  onlyAlerts: boolean;
}

export interface SectionResult {
  html: string;
  after?: (root: HTMLElement) => void;
}

const SECTION_TITLES = labelTable({
  overview: '營運總覽',
  inbound: '入庫作業',
  inventory: '庫存管理',
  orders: '訂單履行',
  tasks: '人員與任務',
  transport: '運輸管理',
});

export function sectionTitle(id: SectionId): string {
  return SECTION_TITLES(id);
}

function stat(label: string, value: string, unit?: string): string {
  return `<div class="stat"><div class="stat__label">${esc(label)}</div><div class="stat__value">${esc(value)}${
    unit ? `<small>${esc(unit)}</small>` : ''
  }</div></div>`;
}

function badge(text: string, tone: string): string {
  return `<span class="badge badge--${tone}">${esc(text)}</span>`;
}

/* ====================================================================== */
/* Overview                                                               */
/* ====================================================================== */

export function renderOverview(engine: SimulationEngine): SectionResult {
  const kpi = engine.kpi;
  const alerts = engine.alerts.slice(0, 8);

  const zoneBars = engine.layout.zones.map((zone) => {
    let used = 0;
    let capacity = 0;
    for (const loc of engine.layout.locations.values()) {
      if (loc.zoneId !== zone.id) continue;
      used += engine.inventory.locationWeight(loc.id);
      capacity += loc.maxWeight;
    }
    return {
      label: t('{0} 區', zone.id),
      value: capacity > 0 ? (used / capacity) * 100 : 0,
      color: `#${zone.color.toString(16).padStart(6, '0')}`,
    };
  });

  const orderCounts = new Map<string, number>();
  for (const order of engine.orders.values()) {
    orderCounts.set(order.status, (orderCounts.get(order.status) ?? 0) + 1);
  }
  const donut = [
    { label: t('揀貨中'), value: orderCounts.get('picking') ?? 0, color: '#0f8f8f' },
    { label: t('打包中'), value: orderCounts.get('packing') ?? 0, color: '#276bb9' },
    { label: t('待釋出'), value: orderCounts.get('released') ?? 0, color: '#b05c00' },
    { label: t('待裝車'), value: orderCounts.get('staged') ?? 0, color: '#7c5cd6' },
    { label: t('已出貨'), value: orderCounts.get('shipped') ?? 0, color: '#1c8039' },
  ];

  const html = `
    <div class="sec">
      <div class="sec__head"><h2>${t('核心 KPI')}</h2><span class="sec__count">${t('即時')}</span></div>
      <div class="sec__body">
        <div class="stat-grid">
          ${stat(t('倉儲利用率'), fmtInt(kpi.warehouseUtilisation), '%')}
          ${stat(t('揀貨準確率'), fmt1(kpi.pickAccuracy), '%')}
          ${stat(t('準時出貨率'), fmt1(kpi.onTimeDelivery), '%')}
          ${stat(t('平均訂單週期'), fmtInt(kpi.orderCycleMinutes), t('分'))}
          ${stat(t('月台使用率'), fmt1(kpi.dockUtilisation), '%')}
          ${stat(t('車隊使用率'), fmt1(kpi.fleetUtilisation), '%')}
          ${stat(t('庫存周轉率'), fmt2(kpi.inventoryTurnover), t('次'))}
          ${stat(t('在手訂單'), fmtInt(kpi.openOrders), t('單'))}
        </div>
      </div>
    </div>

    <div class="sec">
      <div class="sec__head"><h2>${t('出貨吞吐（每小時）')}</h2><span class="sec__count">${t('近 96 筆')}</span></div>
      <div class="sec__body">
        <canvas class="chart" id="chart-throughput" height="70"></canvas>
        <div class="legend">
          <span><i style="background:#0f8f8f"></i>${t('出貨件數/小時')}</span>
        </div>
      </div>
    </div>

    <div class="sec">
      <div class="sec__head"><h2>${t('區域儲位利用率')}</h2></div>
      <div class="sec__body">
        <canvas class="chart" id="chart-zones" height="150"></canvas>
      </div>
    </div>

    <div class="sec">
      <div class="sec__head"><h2>${t('訂單狀態分布')}</h2></div>
      <div class="sec__body">
        <canvas class="chart" id="chart-orders" height="150"></canvas>
      </div>
    </div>

    <div class="sec">
      <div class="sec__head"><h2>${t('異常告警')}</h2><span class="sec__count">${engine.alerts.length}</span></div>
      <div class="sec__body">
        ${
          alerts.length === 0
            ? `<div class="muted tiny">${t('目前無異常事件，系統運作正常。')}</div>`
            : alerts
                .map(
                  (alert) => `
          <div class="alert ${alert.severity === 'danger' ? 'alert--danger' : alert.severity === 'info' ? 'alert--info' : ''}">
            <div class="alert__t"><span>${esc(renderMessage(alert.title))}</span><span class="muted mono">${esc(
              formatDay(alert.at),
            )}</span></div>
            <div class="alert__d">${esc(renderMessage(alert.detail))}</div>
          </div>`,
                )
                .join('')
        }
      </div>
    </div>

    <div class="sec">
      <div class="sec__head"><h2>${t('作業負荷')}</h2></div>
      <div class="sec__body">
        <div class="stat-grid">
          ${stat(t('進行中任務'), fmtInt(engine.activeTaskCount()), t('項'))}
          ${stat(t('待處理任務'), fmtInt(engine.taskList(999).filter((t2) => t2.status === 'queued').length), t('項'))}
          ${stat(t('活躍人員'), fmtInt(kpi.activeWorkers), t('人'))}
          ${stat(t('待出貨訂單'), fmtInt([...engine.orders.values()].filter((o) => o.status === 'packed').length), t('單'))}
        </div>
      </div>
    </div>
  `;

  return {
    html,
    after(root) {
      const throughput = root.querySelector<HTMLCanvasElement>('#chart-throughput');
      if (throughput) {
        drawSparkline(throughput, engine.history.map((h) => h.throughput), { height: 70 });
      }
      const zones = root.querySelector<HTMLCanvasElement>('#chart-zones');
      if (zones) drawBars(zones, zoneBars, { max: 100, unit: '%' });
      const orders = root.querySelector<HTMLCanvasElement>('#chart-orders');
      if (orders) drawDonut(orders, donut);
    },
  };
}

/* ====================================================================== */
/* Inbound                                                                */
/* ====================================================================== */

export function renderInbound(engine: SimulationEngine): SectionResult {
  const docks = engine.layout.docks;
  const asns = [...engine.asns].sort((a, b) => a.eta - b.eta).slice(0, 14);

  const html = `
    <div class="sec">
      <div class="sec__head"><h2>${t('月台狀態')}</h2><span class="sec__count">${docks.length} ${t('座')}</span></div>
      <div class="sec__body">
        <table class="tbl">
          <thead><tr><th>${t('月台')}</th><th>${t('方向')}</th><th>${t('狀態')}</th><th>${t('作業單')}</th></tr></thead>
          <tbody>
          ${docks
            .map(
              (dock) => `
            <tr>
              <td class="mono">${esc(dock.id)}</td>
              <td>${dock.kind === 'inbound' ? t('進貨') : t('出貨')}</td>
              <td>${dock.occupiedBy ? badge(t('使用中'), 'busy') : badge(t('空閒'), 'muted')}</td>
              <td class="mono tiny">${esc(dock.occupiedBy ?? '—')}</td>
            </tr>`,
            )
            .join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="sec">
      <div class="sec__head"><h2>${t('預到貨通知 ASN')}</h2><span class="sec__count">${engine.asns.length}</span></div>
      <div class="sec__body">
        ${
          asns.length === 0
            ? `<div class="muted tiny">${t('沒有待處理 ASN。')}</div>`
            : asns
                .map((asn) => {
                  const received = asn.lines.reduce((s, l) => s + l.receivedQty, 0);
                  const total = asn.lines.reduce((s, l) => s + l.qty, 0);
                  const ratio = total > 0 ? received / total : 0;
                  const tone = statusTone(asn.status);
                  const statusText =
                    asn.status === 'scheduled'
                      ? t('預計 {0}後到貨', formatMinutes(asn.eta - engine.simTime))
                      : asn.status === 'arrived'
                        ? t('已到場待卸貨')
                        : asn.status === 'receiving'
                          ? t('收貨中')
                          : asn.status === 'putaway'
                            ? t('上架中')
                            : t('已完成');
                  return `
                  <div class="card" data-asn="${esc(asn.id)}">
                    <div class="card__top">
                      <span class="dot dot--${tone}"></span>
                      <span class="card__id">${esc(asn.id)}</span>
                      ${badge(PRIORITY_LABEL(asn.priority), tone)}
                      <span class="muted tiny" style="margin-left:auto">${esc(statusText)}</span>
                    </div>
                    <div class="card__meta">
                      <span>${t('供應商')} <b>${esc(localize(asn.supplier, asn.supplierEn))}</b></span>
                      <span>PO <b>${esc(asn.poNo)}</b></span>
                      <span>${t('貨重')} <b>${esc(fmtWeight(asn.totalWeight))}</b></span>
                      <span>${t('貨櫃')} <b>${asn.pallets}</b></span>
                    </div>
                    <div class="bar"><div class="bar__fill" style="width:${Math.round(ratio * 100)}%"></div></div>
                  </div>`;
                })
                .join('')
        }
      </div>
    </div>

    <div class="sec">
      <div class="sec__head"><h2>${t('收貨 / 上架任務')}</h2></div>
      <div class="sec__body">
        ${
          engine
            .taskList(200)
            .filter((task) => task.kind === 'receive' || task.kind === 'putaway')
            .slice(0, 14)
            .map((task) => taskRow(task, engine))
            .join('') || `<div class="muted tiny">${t('目前沒有收貨作業。')}</div>`
        }
      </div>
    </div>
  `;

  return { html };
}

/* ====================================================================== */
/* Inventory                                                              */
/* ====================================================================== */

export function renderInventory(engine: SimulationEngine, filters: UiFilters): SectionResult {
  const search = filters.search.trim().toLowerCase();

  const zones = engine.layout.zones.map((zone) => {
    let used = 0;
    let capacity = 0;
    let count = 0;
    for (const loc of engine.layout.locations.values()) {
      if (loc.zoneId !== zone.id) continue;
      used += engine.inventory.locationWeight(loc.id);
      capacity += loc.maxWeight;
      if (engine.inventory.locationWeight(loc.id) > 0) count++;
    }
    return { zone, used, capacity, count };
  });

  const stockRows = engine.skus
    .filter((sku) => {
      if (!search) return true;
      return (
        sku.id.toLowerCase().includes(search) ||
        sku.name.toLowerCase().includes(search) ||
        sku.nameEn.toLowerCase().includes(search) ||
        sku.category.toLowerCase().includes(search) ||
        sku.categoryEn.toLowerCase().includes(search) ||
        sku.barcode.includes(search)
      );
    })
    .slice(0, 40)
    .map((sku) => {
      const onHand = engine.inventory.onHand(sku.id);
      const reserved = engine.inventory.reservedQty(sku.id);
      const abc = sku.abcClass === 'A' ? t('A級') : sku.abcClass === 'B' ? t('B級') : t('C級');
      return `
      <tr data-sku="${esc(sku.id)}">
        <td class="mono tiny">${esc(sku.id)}</td>
        <td>${esc(skuName(sku))}</td>
        <td>${esc(skuCategory(sku))}</td>
        <td class="num">${fmtInt(onHand)}</td>
        <td class="num">${fmtInt(reserved)}</td>
        <td>${badge(abc, sku.abcClass === 'A' ? 'warn' : 'muted')}</td>
      </tr>`;
    })
    .join('');

  const hotLocations = [...engine.layout.locations.values()]
    .filter((loc) => loc.palletPosition && engine.inventory.locationWeight(loc.id) > 0)
    .sort((a, b) => engine.inventory.locationWeight(b.id) - engine.inventory.locationWeight(a.id))
    .slice(0, 18);

  const html = `
    <div class="sec">
      <div class="sec__head"><h2>${t('庫存總覽')}</h2></div>
      <div class="sec__body">
        <div class="stat-grid">
          ${stat(t('庫位總數'), fmtInt(engine.layout.locations.size), t('個'))}
          ${stat(t('有貨庫位'), fmtInt(countStocked(engine)), t('個'))}
          ${stat(t('SKU 數'), fmtInt(engine.skus.length), t('種'))}
          ${stat(t('庫存總值'), fmtMoney(engine.inventory.inventoryValue()), '')}
        </div>
      </div>
    </div>

    <div class="sec">
      <div class="sec__head"><h2>${t('儲區容量')}</h2></div>
      <div class="sec__body">
        <canvas class="chart" id="chart-inv-zones" height="150"></canvas>
      </div>
    </div>

    <div class="sec">
      <div class="sec__head"><h2>${t('SKU 庫存查詢')}</h2></div>
      <div class="sec__body">
        <div class="toolbar">
          <div class="field"><input id="inv-search" type="search" placeholder="${esc(
            t('搜尋 SKU / 名稱 / 條碼'),
          )}" value="${esc(filters.search)}" /></div>
        </div>
        <table class="tbl">
          <thead><tr><th>${t('料號')}</th><th>${t('品名')}</th><th>${t('類別')}</th><th class="num">${t('在手')}</th><th class="num">${t('已分配')}</th><th>ABC</th></tr></thead>
          <tbody>${stockRows || `<tr><td colspan="6" class="muted tiny">${t('查無結果')}</td></tr>`}</tbody>
        </table>
      </div>
    </div>

    <div class="sec">
      <div class="sec__head"><h2>${t('高儲位庫存')}</h2></div>
      <div class="sec__body">
        <table class="tbl">
          <thead><tr><th>${t('庫位')}</th><th>${t('區')}</th><th class="num">${t('重量')}</th><th class="num">${t('利用率')}</th></tr></thead>
          <tbody>
          ${hotLocations
            .map(
              (loc) => `
            <tr data-location="${esc(loc.id)}">
              <td class="mono tiny">${esc(loc.id)}</td>
              <td>${esc(loc.zoneId)}</td>
              <td class="num">${fmtInt(engine.inventory.locationWeight(loc.id))}</td>
              <td class="num">${fmtInt(loc.utilisation * 100)}%</td>
            </tr>`,
            )
            .join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="sec">
      <div class="sec__head"><h2>${t('最近異動')}</h2></div>
      <div class="sec__body">
        <table class="tbl">
          <thead><tr><th>${t('時間')}</th><th>${t('類型')}</th><th>${t('品項')}</th><th class="num">${t('數量')}</th></tr></thead>
          <tbody>
          ${engine.inventory.movements
            .slice(-14)
            .reverse()
            .map(
              (movement) => `
            <tr>
              <td class="mono tiny">${esc(formatDay(movement.at))}</td>
              <td>${esc(MOVEMENT_LABEL(movement.kind))}</td>
              <td class="tiny">${esc(engine.skuById.get(movement.skuId) ? skuName(engine.skuById.get(movement.skuId)!) : movement.skuId)}</td>
              <td class="num">${fmtInt(movement.qty)}</td>
            </tr>`,
            )
            .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  return {
    html,
    after(root) {
      const canvas = root.querySelector<HTMLCanvasElement>('#chart-inv-zones');
      if (canvas) {
        drawBars(
          canvas,
          zones.map((z) => ({
            label: t('{0} 區', z.zone.id),
            value: z.capacity > 0 ? (z.used / z.capacity) * 100 : 0,
          })),
          { max: 100, unit: '%' },
        );
      }
    },
  };
}

function countStocked(engine: SimulationEngine): number {
  let count = 0;
  for (const loc of engine.layout.locations.values()) {
    if (engine.inventory.locationWeight(loc.id) > 0) count++;
  }
  return count;
}

/** Carbon output: kilograms below one tonne, tonnes above. */
function fmtCo2(tonnes: number): string {
  if (tonnes < 1) return `${fmtInt(tonnes * 1000)} kg`;
  return `${fmt2(tonnes)} t`;
}

/* ====================================================================== */
/* Orders                                                                 */
/* ====================================================================== */

export function renderOrders(engine: SimulationEngine, filters: UiFilters): SectionResult {
  const all = engine.orderList();
  const filtered = all.filter((order) => {
    if (filters.orderStatus && order.status !== filters.orderStatus) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const customer = order.customer.toLowerCase();
      const customerEn = order.customerEn.toLowerCase();
      if (!order.id.toLowerCase().includes(q) && !customer.includes(q) && !customerEn.includes(q)) {
        return false;
      }
    }
    return true;
  });

  const waves = [...engine.waves.values()].slice(-8).reverse();

  const html = `
    <div class="sec">
      <div class="sec__head"><h2>${t('訂單篩選')}</h2><span class="sec__count">${filtered.length}/${all.length}</span></div>
      <div class="sec__body">
        <div class="toolbar">
          <div class="field"><input id="order-search" type="search" placeholder="${esc(
            t('搜尋訂單號 / 客戶'),
          )}" value="${esc(filters.search)}" /></div>
        </div>
        <div class="toolbar" id="order-status-chips">
          ${['', 'released', 'picking', 'packing', 'packed', 'staged', 'shipped']
            .map(
              (status) =>
                `<button class="chip chip--sm ${filters.orderStatus === status ? 'is-active' : ''}" data-status="${status}">${
                  status === '' ? t('全部') : ORDER_STATUS_LABEL(status)
                }</button>`,
            )
            .join('')}
        </div>
      </div>
    </div>

    <div class="sec">
      <div class="sec__head"><h2>${t('揀貨波次')}</h2><span class="sec__count">${engine.waves.size}</span></div>
      <div class="sec__body">
        ${
          waves.length === 0
            ? `<div class="muted tiny">${t('尚未釋出波次。')}</div>`
            : waves
                .map(
                  (wave) => `
          <div class="card" data-wave="${esc(wave.id)}">
            <div class="card__top">
              <span class="dot dot--${statusTone(wave.status)}"></span>
              <span class="card__id">${esc(wave.code)}</span>
              ${badge(wave.carrierCode, 'info')}
              <span class="muted tiny" style="margin-left:auto">${wave.orderIds.length} ${t('單')} · ${wave.pickerIds.length} ${t('人')}</span>
            </div>
            <div class="card__meta">
              <span>${t('狀態')} <b>${esc(WAVE_STATUS(wave.status))}</b></span>
              <span>${t('建立')} <b>${esc(formatDay(wave.createdAt))}</b></span>
            </div>
          </div>`,
                )
                .join('')
        }
      </div>
    </div>

    <div class="sec">
      <div class="sec__head"><h2>${t('銷售訂單')}</h2></div>
      <div class="sec__body">
        ${
          filtered
            .slice(0, 24)
            .map((order) => orderRow(order, engine))
            .join('') || `<div class="muted tiny">${t('查無訂單。')}</div>`
        }
      </div>
    </div>
  `;

  return { html };
}

function orderRow(order: Order, engine: SimulationEngine): string {
  const tone = statusTone(order.status);
  const picked = order.lines.reduce((s, l) => s + l.pickedQty, 0);
  const total = order.lines.reduce((s, l) => s + l.qty, 0);
  const ratio = total > 0 ? picked / total : 0;
  const overdue = engine.simTime > order.dueAt && order.status !== 'shipped';
  return `
  <div class="card" data-order="${esc(order.id)}">
    <div class="card__top">
      <span class="dot dot--${tone}"></span>
      <span class="card__id">${esc(order.id)}</span>
      ${badge(PRIORITY_LABEL(order.priority), statusTone(order.priority))}
      <span class="badge badge--${tone}" style="margin-left:auto">${esc(ORDER_STATUS_LABEL(order.status))}</span>
    </div>
    <div class="card__meta">
      <span>${t('客戶')} <b>${esc(localize(order.customer, order.customerEn))}</b></span>
      <span>${t('通路')} <b>${esc(CHANNEL_LABEL(order.channel))}</b></span>
      <span>${t('行數')} <b>${order.lines.length}</b></span>
      <span>${t('重量')} <b>${esc(fmtWeight(order.weight))}</b></span>
      ${overdue ? `<span style="color:var(--danger)">${t('已逾期')}</span>` : ''}
    </div>
    ${
      order.status === 'picking' || order.status === 'packing'
        ? `<div class="bar"><div class="bar__fill" style="width:${Math.round(ratio * 100)}%"></div></div>`
        : ''
    }
  </div>`;
}

/* ====================================================================== */
/* Tasks & people                                                         */
/* ====================================================================== */

export function renderTasks(engine: SimulationEngine, filters: UiFilters): SectionResult {
  const tasks = engine.taskList(200).filter((task) => {
    if (filters.taskKind && task.kind !== filters.taskKind) return false;
    if (filters.zone && task.zoneId !== filters.zone) return false;
    return true;
  });

  const kinds = ['receive', 'putaway', 'pick', 'pack', 'load', 'replenish', 'cyclecount'];

  const workers = engine.workers.map((worker) => {
    const task = worker.busyTaskId ? engine.tasks.get(worker.busyTaskId) : undefined;
    return `
    <div class="card" data-worker="${esc(worker.id)}">
      <div class="card__top">
        <span class="dot dot--${worker.busyTaskId ? 'busy' : 'muted'}"></span>
        <span class="card__id">${esc(worker.name)}</span>
        <span class="muted tiny" style="margin-left:auto">${esc(ROLE_LABEL(worker.role))}</span>
      </div>
      <div class="card__meta">
        <span>${esc(worker.id)}</span>
        <span>${t('效率')} <b>${Math.round(worker.skill * 100)}%</b></span>
        <span>${task ? esc(renderMessage(task.label)) : `<b>${t('待命')}</b>`}</span>
      </div>
    </div>`;
  });

  const html = `
    <div class="sec">
      <div class="sec__head"><h2>${t('任務篩選')}</h2></div>
      <div class="sec__body">
        <div class="toolbar" id="task-kind-chips">
          ${kinds
            .map(
              (kind) =>
                `<button class="chip chip--sm ${filters.taskKind === kind ? 'is-active' : ''}" data-kind="${kind}">${esc(
                  TASK_LABEL(kind),
                )}</button>`,
            )
            .join('')}
        </div>
      </div>
    </div>

    <div class="sec">
      <div class="sec__head"><h2>${t('工作佇列')}</h2><span class="sec__count">${tasks.length}</span></div>
      <div class="sec__body">
        ${
          tasks.length === 0
            ? `<div class="muted tiny">${t('沒有符合條件的任務。')}</div>`
            : tasks.slice(0, 30).map((task) => taskRow(task, engine)).join('')
        }
      </div>
    </div>

    <div class="sec">
      <div class="sec__head"><h2>${t('人員編制')}</h2><span class="sec__count">${engine.workers.length} ${t('人')}</span></div>
      <div class="sec__body">${workers.join('')}</div>
    </div>
  `;

  return { html };
}

function taskRow(task: Task, _engine: SimulationEngine): string {
  const tone = statusTone(task.status);
  const assignee = task.assignee ?? t('未指派');
  const progress = Math.round(task.progress * 100);
  return `
  <div class="task" data-task="${esc(task.id)}">
    <span class="task__icon">${esc(TASK_LABEL(task.kind).slice(0, 1))}</span>
    <div class="task__body">
      <div class="task__title">
        <span>${esc(task.id)}</span>
        ${badge(TASK_LABEL(task.kind), tone)}
        ${task.priority !== 'standard' ? badge(PRIORITY_LABEL(task.priority), statusTone(task.priority)) : ''}
        <span class="muted tiny" style="margin-left:auto">${esc(assignee)}</span>
      </div>
      <div class="task__sub">${esc(renderMessage(task.label))}${task.locationId ? ` · ${esc(task.locationId)}` : ''}</div>
      ${
        task.status === 'active'
          ? `<div class="bar"><div class="bar__fill" style="width:${progress}%"></div></div>`
          : ''
      }
    </div>
  </div>`;
}

/* ====================================================================== */
/* Transport                                                              */
/* ====================================================================== */

export function renderTransport(engine: SimulationEngine): SectionResult {
  const shipments = [...engine.shipments.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 12);
  const vehicles = engine.vehicles;

  const html = `
    <div class="sec">
      <div class="sec__head"><h2>${t('運輸 KPI')}</h2></div>
      <div class="sec__body">
        <div class="stat-grid">
          ${stat(t('車隊規模'), fmtInt(vehicles.length), t('輛'))}
          ${stat(t('在途車輛'), fmtInt(vehicles.filter((v) => v.status === 'enroute' || v.status === 'delivering').length), t('輛'))}
          ${stat(t('累計碳排'), fmtCo2(engine.kpi.co2Tonnes), '')}
          ${stat(t('出貨批次'), fmtInt(shipments.length), t('批'))}
        </div>
      </div>
    </div>

    <div class="sec">
      <div class="sec__head"><h2>${t('車隊狀態')}</h2></div>
      <div class="sec__body">
        ${vehicles
          .map(
            (vehicle) => `
          <div class="card" data-vehicle="${esc(vehicle.id)}">
            <div class="card__top">
              <span class="dot dot--${vehicle.status === 'idle' ? 'muted' : 'busy'}"></span>
              <span class="card__id">${esc(vehicle.plate)}</span>
              <span class="muted tiny">${esc(vehicle.id)}</span>
              <span class="badge badge--${statusTone(vehicle.status)}" style="margin-left:auto">${esc(
                VEHICLE_STATUS_LABEL(vehicle.status),
              )}</span>
            </div>
            <div class="card__meta">
              <span>${t('類型')} <b>${esc(VEHICLE_KIND(vehicle.kind))}</b></span>
              <span>${t('載重')} <b>${fmtInt(vehicle.load * 100)}%</b></span>
              <span>${vehicle.destination ? esc(localize(vehicle.destination, vehicle.destinationEn)) : `<b>${t('待命')}</b>`}</span>
              ${
                vehicle.status === 'enroute' || vehicle.status === 'delivering'
                  ? `<span>ETA <b>${esc(fmtEta(vehicle.etaMinutes))}</b></span>`
                  : ''
              }
            </div>
            ${
              vehicle.status === 'enroute' || vehicle.status === 'delivering'
                ? `<div class="bar"><div class="bar__fill" style="width:${Math.round(vehicle.roadProgress * 100)}%"></div></div>`
                : ''
            }
          </div>`,
          )
          .join('')}
      </div>
    </div>

    <div class="sec">
      <div class="sec__head"><h2>${t('出貨批次 TMS')}</h2><span class="sec__count">${engine.shipments.size}</span></div>
      <div class="sec__body">
        ${
          shipments.length === 0
            ? `<div class="muted tiny">${t('尚未產生出貨批次。')}</div>`
            : shipments
                .map((shipment) => {
                  return `
          <div class="card" data-shipment="${esc(shipment.id)}">
            <div class="card__top">
              <span class="dot dot--${statusTone(shipment.status)}"></span>
              <span class="card__id">${esc(shipment.id)}</span>
              <span class="muted tiny">${esc(localize(shipment.carrier, shipment.carrierEn))}</span>
              <span class="badge badge--${statusTone(shipment.status)}" style="margin-left:auto">${esc(
                SHIPMENT_STATUS(shipment.status),
              )}</span>
            </div>
            <div class="card__meta">
              <span>${t('目的地')} <b>${esc(localize(shipment.destination, shipment.destinationEn))}</b></span>
              <span>${t('訂單')} <b>${shipment.orderIds.length}</b></span>
              <span>${t('件數')} <b>${shipment.parcels}</b></span>
              <span>${t('距離')} <b>${fmtInt(shipment.distanceKm)} km</b></span>
            </div>
            <canvas class="chart" data-strip="${esc(shipment.id)}" height="26" style="margin-top:6px"></canvas>
          </div>`;
                })
                .join('')
        }
      </div>
    </div>
  `;

  return {
    html,
    after(root) {
      root.querySelectorAll<HTMLCanvasElement>('canvas[data-strip]').forEach((canvas) => {
        const id = canvas.dataset.strip!;
        const shipment = engine.shipments.get(id);
        if (!shipment) return;
        const vehicle = shipment.vehicleId ? engine.vehicles.find((v) => v.id === shipment.vehicleId) : undefined;
        const progress = vehicle?.roadProgress ?? 0;
        drawRouteStrip(canvas, [
          { label: t('倉'), ratio: 0.12, color: '#0f8f8f' },
          { label: t('路'), ratio: Math.max(0.02, progress * 0.78), color: '#276bb9' },
          { label: t('點'), ratio: 0.1, color: '#b05c00' },
        ]);
      });
    },
  };
}