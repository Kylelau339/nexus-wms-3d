import { localize, renderMessage, t } from '../core/i18n';
import type { SimulationEngine } from '../domain/engine';
import { formatDay } from '../domain/engine';
import { skuCategory, skuHazard, skuName } from '../domain/labels';
import type { Alert } from '../domain/types';
import {
  batchUnit,
  binUnit,
  CHANNEL_LABEL,
  esc,
  fmtCompact,
  fmtDuration,
  fmtEta,
  fmtInt,
  fmtMoney,
  fmtWeight,
  ORDER_STATUS_LABEL,
  PRIORITY_LABEL,
  ROLE_LABEL,
  statusTone,
  TASK_LABEL,
  taskUnit,
  TEMP_LABEL,
  waveUnit,
} from './dom';

export interface InspectorActions {
  focusLocation(locationId: string): void;
  focusOrder(orderId: string): void;
  focusVehicle(vehicleId: string): void;
}

interface Stage {
  key: string;
  label: string;
  count: number;
  unit: string;
  color: string;
}

export function buildStages(engine: SimulationEngine): Stage[] {
  const tasks = engine.taskList(999);
  const activeOf = (kind: string) => tasks.filter((t) => t.kind === kind && t.status === 'active').length;
  let stocked = 0;
  for (const loc of engine.layout.locations.values()) {
    if (engine.inventory.locationWeight(loc.id) > 0) stocked++;
  }
  const receiving = activeOf('receive');
  const putaway = activeOf('putaway');
  const picking = activeOf('pick');
  const packing = activeOf('pack');
  const loading = activeOf('load');
  const transport = [...engine.shipments.values()].filter(
    (s) => s.status === 'enroute' || s.status === 'delivering',
  ).length;

  return [
    { key: 'receive', label: t('進貨收貨'), count: receiving, unit: taskUnit(receiving), color: '#0f8f8f' },
    { key: 'putaway', label: t('上架儲位'), count: putaway, unit: taskUnit(putaway), color: '#276bb9' },
    { key: 'storage', label: t('庫存持有'), count: stocked, unit: binUnit(stocked), color: '#1c8039' },
    { key: 'wave', label: t('波次釋出'), count: engine.waves.size, unit: waveUnit(engine.waves.size), color: '#b05c00' },
    { key: 'pick', label: t('揀貨作業'), count: picking, unit: taskUnit(picking), color: '#b05c00' },
    { key: 'pack', label: t('打包覆核'), count: packing, unit: taskUnit(packing), color: '#7c5cd6' },
    { key: 'load', label: t('裝車出貨'), count: loading, unit: taskUnit(loading), color: '#b05c00' },
    {
      key: 'transport',
      label: t('運輸配送'),
      count: transport,
      unit: batchUnit(transport),
      color: '#276bb9',
    },
  ];
}

export function renderInspector(
  engine: SimulationEngine,
  actions: InspectorActions,
): string {
  const stages = buildStages(engine);
  const flow = `
    <div class="sec">
      <div class="sec__head"><h3>${t('全流程即時狀態')}</h3><span class="sec__count">${t('8 階段')}</span></div>
      <div class="sec__body">
        ${stages
          .map(
            (stage, i) => `
          <div class="task" style="cursor:default">
            <span class="task__icon" style="background:${stage.color}22;color:${stage.color};border:1px solid ${stage.color}55">${i + 1}</span>
            <div class="task__body">
              <div class="task__title">
                <span>${esc(stage.label)}</span>
                <span class="mono" style="margin-left:auto;color:${stage.color}">${fmtInt(stage.count)} ${esc(
                  stage.unit,
                )}</span>
              </div>
              <div class="bar"><div class="bar__fill" style="width:${Math.min(
                100,
                Math.round((stage.count / Math.max(1, stagesMax(stages))) * 100),
              )}%;background:${stage.color}"></div></div>
            </div>
          </div>`,
          )
          .join('')}
      </div>
    </div>`;

  const selection = engine.selection;
  let detail = '';
  switch (selection.kind) {
    case 'location':
      detail = renderLocation(engine, selection.id, actions);
      break;
    case 'order':
      detail = renderOrder(engine, selection.id, actions);
      break;
    case 'wave':
      detail = renderWave(engine, selection.id);
      break;
    case 'task':
      detail = renderTask(engine, selection.id);
      break;
    case 'shipment':
      detail = renderShipment(engine, selection.id);
      break;
    case 'sku':
      detail = renderSku(engine, selection.id);
      break;
    default:
      detail = renderHint(engine);
      break;
  }

  return flow + detail;
}

function stagesMax(stages: Stage[]): number {
  return Math.max(1, ...stages.map((s) => s.count));
}

function renderHint(engine: SimulationEngine): string {
  const recent = engine.alerts.slice(0, 4);
  return `
    <div class="sec">
      <div class="sec__head"><h3>${t('操作指引')}</h3></div>
      <div class="sec__body">
        <div class="muted tiny" style="line-height:1.75">
          · ${t('點選')} <b>${t('貨架貨位')}</b> ${t('可查看庫存明細與揀貨來源')}<br />
          · ${t('點選')} <b>${t('訂單 / 波次')}</b> ${t('會在 3D 場景標示揀貨路徑')}<br />
          · ${t('點選')} <b>${t('卡車')}</b> ${t('可追蹤其運輸狀態與 ETA')}<br />
          · ${t('左鍵拖曳旋轉、右鍵平移、滾輪縮放')}<br />
          · ${t('鍵盤')} <b>1–6</b> ${t('切換視角、')}<b>${t('空白鍵')}</b> ${t('暫停、')}<b>F</b> ${t('跟隨選取')}
        </div>
      </div>
    </div>
    <div class="sec">
      <div class="sec__head"><h3>${t('庫存價值')}</h3></div>
      <div class="sec__body">
        <div class="stat-grid">
          <div class="stat"><div class="stat__label">${t('庫存總值')}</div><div class="stat__value">${esc(
            fmtMoney(engine.inventory.inventoryValue()),
          )}</div></div>
          <div class="stat"><div class="stat__label">${t('在手件數')}</div><div class="stat__value">${esc(
            fmtCompact(engine.inventory.totalUnits()),
          )}</div></div>
          <div class="stat"><div class="stat__label">${t('已分配件數')}</div><div class="stat__value">${esc(
            fmtCompact(engine.skus.reduce((s, sku) => s + engine.inventory.reservedQty(sku.id), 0)),
          )}</div></div>
          <div class="stat"><div class="stat__label">${t('作業人員')}</div><div class="stat__value">${esc(
            fmtInt(engine.workers.length),
          )}<small>${t('人')}</small></div></div>
        </div>
      </div>
    </div>
    ${
      recent.length
        ? `<div class="sec">
      <div class="sec__head"><h3>${t('即時告警')}</h3></div>
      <div class="sec__body">
        ${recent.map((a) => alertBlock(a)).join('')}
      </div>
    </div>`
        : ''
    }`;
}

function alertBlock(alert: Alert): string {
  return `<div class="alert ${alert.severity === 'danger' ? 'alert--danger' : alert.severity === 'info' ? 'alert--info' : ''}">
    <div class="alert__t"><span>${esc(renderMessage(alert.title))}</span><span class="muted mono">${esc(
      formatDay(alert.at),
    )}</span></div>
    <div class="alert__d">${esc(renderMessage(alert.detail))}</div>
  </div>`;
}

function renderLocation(engine: SimulationEngine, id: string, _actions: InspectorActions): string {
  const loc = engine.layout.locations.get(id);
  if (!loc) return '';
  const lots = engine.inventory.lotsAt(id);
  const weight = engine.inventory.locationWeight(id);
  const volume = engine.inventory.locationVolume(id);

  return `
    <div class="sec">
      <div class="sec__head"><h3>${t('庫位明細')}</h3><span class="sec__count">${esc(id)}</span></div>
      <div class="sec__body">
        <div class="stat-grid">
          <div class="stat"><div class="stat__label">${t('庫位')}</div><div class="stat__value" style="font-size:13px">${esc(
            id,
          )}</div></div>
          <div class="stat"><div class="stat__label">${t('區域 / 溫層')}</div><div class="stat__value" style="font-size:13px">${esc(
            loc.zoneId,
          )} · ${esc(TEMP_LABEL(loc.tempZone))}</div></div>
          <div class="stat"><div class="stat__label">${t('重量')}</div><div class="stat__value">${esc(
            fmtWeight(weight),
          )}</div></div>
          <div class="stat"><div class="stat__label">${t('利用率')}</div><div class="stat__value">${fmtInt(
            loc.utilisation * 100,
          )}<small>%</small></div></div>
        </div>
        <div class="bar" style="margin-top:9px"><div class="bar__fill ${
          loc.utilisation > 0.9 ? 'bar__fill--danger' : loc.utilisation > 0.75 ? 'bar__fill--warn' : ''
        }" style="width:${Math.round(loc.utilisation * 100)}%"></div></div>
        <div class="toolbar" style="margin-top:10px">
          <button class="btn btn--sm" id="btn-focus-bin">${t('在 3D 中定位')}</button>
        </div>
      </div>
    </div>
    <div class="sec">
      <div class="sec__head"><h3>${t('存放批次')}</h3><span class="sec__count">${lots.length}</span></div>
      <div class="sec__body">
        ${
          lots.length === 0
            ? `<div class="muted tiny">${t('此庫位目前空置。')}</div>`
            : `<table class="tbl">
          <thead><tr><th>${t('料號')}</th><th>${t('品名')}</th><th class="num">${t('數量')}</th><th class="num">${t('已配')}</th></tr></thead>
          <tbody>
          ${lots
            .map(
              (lot) => `
            <tr data-sku="${esc(lot.skuId)}">
              <td class="mono tiny">${esc(lot.skuId)}</td>
              <td class="tiny">${esc(skuDisplayName(engine, lot.skuId))}</td>
              <td class="num">${fmtInt(lot.qty)}</td>
              <td class="num">${fmtInt(lot.reservedQty)}</td>
            </tr>`,
            )
            .join('')}
          </tbody>
        </table>`
        }
      </div>
    </div>
    <div class="sec">
      <div class="sec__head"><h3>${t('庫位資訊')}</h3></div>
      <div class="sec__body">
        <table class="tbl">
          <tbody>
            <tr><td class="muted">${t('貨架 / 巷道')}</td><td class="mono tiny">${loc.row} ${t('排')} · ${loc.bay} ${t('格')}</td></tr>
            <tr><td class="muted">${t('層高')}</td><td class="mono tiny">L${loc.level}</td></tr>
            <tr><td class="muted">${t('重量上限')}</td><td class="mono tiny">${fmtInt(loc.maxWeight)} kg</td></tr>
            <tr><td class="muted">${t('體積用量')}</td><td class="mono tiny">${fmtInt(volume)} m³</td></tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

function skuDisplayName(engine: SimulationEngine, skuId: string): string {
  const sku = engine.skuById.get(skuId);
  return sku ? skuName(sku) : skuId;
}

function renderOrder(engine: SimulationEngine, id: string, _actions: InspectorActions): string {
  const order = engine.orders.get(id);
  if (!order) return '';
  const picked = order.lines.reduce((s, l) => s + l.pickedQty, 0);
  const total = order.lines.reduce((s, l) => s + l.qty, 0);
  const tone = statusTone(order.status);

  return `
    <div class="sec">
      <div class="sec__head"><h3>${t('訂單明細')}</h3><span class="sec__count">${esc(order.id)}</span></div>
      <div class="sec__body">
        <div class="card__top" style="margin-bottom:8px">
          <span class="dot dot--${tone}"></span>
          <span class="card__id">${esc(localize(order.customer, order.customerEn))}</span>
          <span class="badge badge--${tone}" style="margin-left:auto">${esc(
            ORDER_STATUS_LABEL(order.status),
          )}</span>
        </div>
        <div class="stat-grid">
          <div class="stat"><div class="stat__label">${t('優先度')}</div><div class="stat__value" style="font-size:13px">${esc(
            PRIORITY_LABEL(order.priority),
          )}</div></div>
          <div class="stat"><div class="stat__label">${t('通路')}</div><div class="stat__value" style="font-size:13px">${esc(
            CHANNEL_LABEL(order.channel),
          )}</div></div>
          <div class="stat"><div class="stat__label">${t('重量')}</div><div class="stat__value">${esc(
            fmtWeight(order.weight),
          )}</div></div>
          <div class="stat"><div class="stat__label">${t('件數')}</div><div class="stat__value">${fmtInt(
            order.parcelCount || order.lines.length,
          )}<small>${t('件')}</small></div></div>
        </div>
        <div class="bar" style="margin-top:9px"><div class="bar__fill" style="width:${Math.round(
          total > 0 ? (picked / total) * 100 : 0,
        )}%"></div></div>
        <table class="tbl" style="margin-top:9px">
          <tbody>
            <tr><td class="muted">${t('建立時間')}</td><td class="mono tiny">${esc(formatDay(order.createdAt))}</td></tr>
            <tr><td class="muted">${t('交期')}</td><td class="mono tiny">${esc(formatDay(order.dueAt))}</td></tr>
            <tr><td class="muted">${t('波次')}</td><td class="mono tiny">${esc(order.waveId ?? t('未釋出'))}</td></tr>
            <tr><td class="muted">${t('出貨批次')}</td><td class="mono tiny">${esc(order.shipmentId ?? '—')}</td></tr>
            <tr><td class="muted">${t('揀貨準確度')}</td><td class="mono tiny">${fmtInt(order.accuracy * 100)}%</td></tr>
          </tbody>
        </table>
        <div class="toolbar" style="margin-top:10px">
          <button class="btn btn--sm btn--primary" id="btn-order-path">${t('顯示揀貨路徑')}</button>
          <button class="btn btn--sm btn--ghost" id="btn-order-focus">${t('定位庫位')}</button>
        </div>
      </div>
    </div>
    <div class="sec">
      <div class="sec__head"><h3>${t('訂單行')}</h3><span class="sec__count">${order.lines.length}</span></div>
      <div class="sec__body">
        <table class="tbl">
          <thead><tr><th>${t('料號')}</th><th>${t('庫位')}</th><th class="num">${t('數量')}</th></tr></thead>
          <tbody>
          ${order.lines
            .map(
              (line) => `
            <tr data-location="${esc(line.locationId)}">
              <td class="tiny">${esc(skuDisplayName(engine, line.skuId))}</td>
              <td class="mono tiny">${esc(line.locationId)}</td>
              <td class="num">${fmtInt(line.pickedQty)}/${fmtInt(line.qty)}</td>
            </tr>`,
            )
            .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderWave(engine: SimulationEngine, id: string): string {
  const wave = engine.waves.get(id);
  if (!wave) return '';
  return `
    <div class="sec">
      <div class="sec__head"><h3>${t('波次明細')}</h3><span class="sec__count">${esc(wave.code)}</span></div>
      <div class="sec__body">
        <div class="stat-grid">
          <div class="stat"><div class="stat__label">${t('訂單數')}</div><div class="stat__value">${wave.orderIds.length}</div></div>
          <div class="stat"><div class="stat__label">${t('揀貨人數')}</div><div class="stat__value">${wave.pickerIds.length}</div></div>
          <div class="stat"><div class="stat__label">${t('承運商')}</div><div class="stat__value" style="font-size:13px">${esc(
            wave.carrierCode,
          )}</div></div>
          <div class="stat"><div class="stat__label">${t('優先度')}</div><div class="stat__value" style="font-size:13px">${esc(
            PRIORITY_LABEL(wave.priority),
          )}</div></div>
        </div>
        <table class="tbl" style="margin-top:9px">
          <tbody>
          ${wave.orderIds
            .map((orderId) => {
              const order = engine.orders.get(orderId);
              return `<tr data-order="${esc(orderId)}"><td class="mono tiny">${esc(orderId)}</td><td class="tiny">${
                order ? esc(localize(order.customer, order.customerEn)) : '—'
              }</td><td class="mono tiny">${esc(
                order ? ORDER_STATUS_LABEL(order.status) : '—',
              )}</td></tr>`;
            })
            .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderTask(engine: SimulationEngine, id: string): string {
  const task = engine.tasks.get(id);
  if (!task) return '';
  const worker = engine.workers.find((w) => w.id === task.assignee);
  const tone = statusTone(task.status);
  return `
    <div class="sec">
      <div class="sec__head"><h3>${t('任務明細')}</h3><span class="sec__count">${esc(task.id)}</span></div>
      <div class="sec__body">
        <div class="card__top" style="margin-bottom:8px">
          <span class="dot dot--${tone}"></span>
          <span class="card__id">${esc(TASK_LABEL(task.kind))}</span>
          <span class="badge badge--${tone}" style="margin-left:auto">${esc(
            task.status === 'done' ? t('已完成') : task.status === 'active' ? t('執行中') : t('佇列中'),
          )}</span>
        </div>
        <div class="muted tiny" style="margin-bottom:8px">${esc(renderMessage(task.label))}</div>
        <div class="bar"><div class="bar__fill" style="width:${Math.round(task.progress * 100)}%"></div></div>
        <table class="tbl" style="margin-top:9px">
          <tbody>
            <tr><td class="muted">${t('關聯單據')}</td><td class="mono tiny">${esc(task.ref)}</td></tr>
            <tr><td class="muted">${t('庫位')}</td><td class="mono tiny">${esc(task.locationId ?? '—')}</td></tr>
            <tr><td class="muted">${t('數量')}</td><td class="mono tiny">${fmtInt(task.qty)}</td></tr>
            <tr><td class="muted">${t('負責人')}</td><td class="mono tiny">${esc(
              worker
                ? `${worker.name}（${ROLE_LABEL(worker.role)}）`
                : task.assignee ?? t('未指派'),
            )}</td></tr>
            <tr><td class="muted">${t('耗時')}</td><td class="mono tiny">${esc(
              task.startedAt ? fmtDuration((task.finishedAt ?? engine.simTime) - task.startedAt) : '—',
            )}</td></tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderShipment(engine: SimulationEngine, id: string): string {
  const shipment = engine.shipments.get(id);
  if (!shipment) return '';
  const vehicle = shipment.vehicleId ? engine.vehicles.find((v) => v.id === shipment.vehicleId) : undefined;
  const tone = statusTone(shipment.status);
  return `
    <div class="sec">
      <div class="sec__head"><h3>${t('出貨批次')}</h3><span class="sec__count">${esc(shipment.id)}</span></div>
      <div class="sec__body">
        <div class="card__top" style="margin-bottom:8px">
          <span class="dot dot--${tone}"></span>
          <span class="card__id">${esc(localize(shipment.destination, shipment.destinationEn))}</span>
          <span class="badge badge--${tone}" style="margin-left:auto">${esc(
            localize(shipment.carrier, shipment.carrierEn),
          )}</span>
        </div>
        <div class="stat-grid">
          <div class="stat"><div class="stat__label">${t('訂單 / 件數')}</div><div class="stat__value">${shipment.orderIds.length}<small>${t('單 / {0} 件', shipment.parcels)}</small></div></div>
          <div class="stat"><div class="stat__label">${t('重量')}</div><div class="stat__value">${esc(
            fmtWeight(shipment.weight),
          )}</div></div>
          <div class="stat"><div class="stat__label">${t('里程')}</div><div class="stat__value">${fmtInt(
            shipment.distanceKm,
          )}<small>km</small></div></div>
          <div class="stat"><div class="stat__label">ETA</div><div class="stat__value" style="font-size:14px">${esc(
            vehicle ? fmtEta(vehicle.etaMinutes) : '—',
          )}</div></div>
        </div>
        <table class="tbl" style="margin-top:9px">
          <tbody>
          ${shipment.orderIds
            .map((orderId) => `<tr data-order="${esc(orderId)}"><td class="mono tiny">${esc(orderId)}</td></tr>`)
            .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderSku(engine: SimulationEngine, id: string): string {
  const sku = engine.skuById.get(id);
  if (!sku) return '';
  const locations = [...engine.layout.locations.values()].filter((loc) =>
    engine.inventory.lotsAt(loc.id).some((lot) => lot.skuId === id),
  );
  const hazard = skuHazard(sku);
  return `
    <div class="sec">
      <div class="sec__head"><h3>${t('品項明細')}</h3><span class="sec__count">${esc(sku.id)}</span></div>
      <div class="sec__body">
        <div class="card__top" style="margin-bottom:8px">
          <span class="card__id">${esc(skuName(sku))}</span>
          <span class="badge badge--muted" style="margin-left:auto">${esc(sku.abcClass)} ${t('級')}</span>
        </div>
        <div class="stat-grid">
          <div class="stat"><div class="stat__label">${t('在手')}</div><div class="stat__value">${fmtInt(
            engine.inventory.onHand(sku.id),
          )}</div></div>
          <div class="stat"><div class="stat__label">${t('已分配')}</div><div class="stat__value">${fmtInt(
            engine.inventory.reservedQty(sku.id),
          )}</div></div>
          <div class="stat"><div class="stat__label">${t('單位重量')}</div><div class="stat__value">${fmtInt(
            sku.unitWeight * 1000,
          )}<small>g</small></div></div>
          <div class="stat"><div class="stat__label">${t('單價')}</div><div class="stat__value">${esc(
            fmtMoney(sku.unitPrice),
          )}</div></div>
        </div>
        <table class="tbl" style="margin-top:9px">
          <tbody>
            <tr><td class="muted">${t('類別')}</td><td class="tiny">${esc(skuCategory(sku))}</td></tr>
            <tr><td class="muted">${t('條碼')}</td><td class="mono tiny">${esc(sku.barcode)}</td></tr>
            <tr><td class="muted">${t('溫層')}</td><td class="tiny">${esc(TEMP_LABEL(sku.tempZone))}</td></tr>
            <tr><td class="muted">${t('危險品')}</td><td class="tiny">${esc(hazard ?? t('無'))}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="sec">
      <div class="sec__head"><h3>${t('存放庫位')}</h3><span class="sec__count">${locations.length}</span></div>
      <div class="sec__body">
        <table class="tbl">
          <tbody>
          ${locations
            .slice(0, 20)
            .map(
              (loc) => `<tr data-location="${esc(loc.id)}"><td class="mono tiny">${esc(loc.id)}</td><td class="num">${fmtInt(
                engine.inventory.lotsAt(loc.id).find((l) => l.skuId === id)!.qty,
              )}</td></tr>`,
            )
            .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

/** Attach listeners for inspector action buttons. */
export function bindInspectorActions(
  root: HTMLElement,
  engine: SimulationEngine,
  actions: InspectorActions,
): void {
  root.querySelector('#btn-focus-bin')?.addEventListener('click', () => {
    if (engine.selection.kind === 'location') actions.focusLocation(engine.selection.id);
  });
  root.querySelector('#btn-order-path')?.addEventListener('click', () => {
    if (engine.selection.kind === 'order') actions.focusOrder(engine.selection.id);
  });
  root.querySelector('#btn-order-focus')?.addEventListener('click', () => {
    if (engine.selection.kind !== 'order') return;
    const order = engine.orders.get(engine.selection.id);
    const first = order?.lines[0]?.locationId;
    if (first) actions.focusLocation(first);
  });
}
