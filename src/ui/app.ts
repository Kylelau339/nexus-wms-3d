import { getLang, htmlLang, labelTable, localize, onLangChange, setLang, t, type Lang } from '../core/i18n';
import type { SimulationEngine } from '../domain/engine';
import { formatClock, formatDay } from '../domain/engine';
import { stationName } from '../domain/labels';
import type { CameraPreset, PickResult, WarehouseScene } from '../three/scene';
import { bindInspectorActions, buildStages, renderInspector, type InspectorActions } from './inspector';
import { mountIncidentHost, type IncidentHost } from './incidents';
import {
  el,
  esc,
  fmt1,
  fmtCompact,
  fmtInt,
  fmtWeight,
  AGV_STATE_LABEL,
} from './dom';
import {
  renderInbound,
  renderInventory,
  renderOrders,
  renderOverview,
  renderTasks,
  renderTransport,
  sectionTitle,
  type SectionId,
  type UiFilters,
} from './sections';

const RAIL_LABELS = labelTable({
  overview: '營運總覽',
  inbound: '入庫作業',
  inventory: '庫存管理',
  orders: '訂單履行',
  tasks: '人員任務',
  transport: '運輸管理',
});

const RAIL: Array<{ id: SectionId; icon: string }> = [
  {
    id: 'overview',
    icon: '<path d="M3 13h4v8H3zM10 3h4v18h-4zM17 8h4v13h-4z"/>',
  },
  {
    id: 'inbound',
    icon: '<path d="M3 9h18v3H3zM5 12v8h14v-8M9 20v-5h6v5"/>',
  },
  {
    id: 'inventory',
    icon: '<path d="M4 8l8-4 8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4"/>',
  },
  {
    id: 'orders',
    icon: '<path d="M7 3h10l3 4v14H4V7zM8 11h8M8 15h5"/>',
  },
  {
    id: 'tasks',
    icon: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 8h5M18.5 5.5v5"/>',
  },
  {
    id: 'transport',
    icon: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  },
];

const PRESET_KEYS: Record<string, CameraPreset> = {
  '1': 'overview',
  '2': 'inbound',
  '3': 'storage',
  '4': 'picking',
  '5': 'packing',
  '6': 'outbound',
};

export class App {
  private section: SectionId = 'overview';
  private filters: UiFilters = {
    zone: '',
    search: '',
    taskKind: '',
    orderStatus: '',
    onlyAlerts: false,
  };
  private lastLeftRender = 0;
  private lastRightRender = 0;
  private lastTopRender = 0;
  private fps = 60;
  private frameCount = 0;
  private frameTime = performance.now();
  private inspectorActions: InspectorActions;
  /** Host for the runtime incident notices. */
  private incidents: IncidentHost | null = null;

  private readonly leftPanel = document.getElementById('left-panel')!;
  private readonly rightPanel = document.getElementById('right-panel')!;
  private readonly railEl = document.getElementById('rail')!;
  private readonly kpiStrip = document.getElementById('kpi-strip')!;
  private readonly clockEl = document.getElementById('sim-clock')!;
  private readonly dateEl = document.getElementById('sim-date')!;
  private readonly statusEl = document.getElementById('statusbar')!;
  private readonly tooltip = document.getElementById('tooltip')!;

  constructor(
    private readonly engine: SimulationEngine,
    private readonly scene: WarehouseScene,
  ) {
    this.inspectorActions = {
      focusLocation: (id) => {
        const loc = engine.layout.locations.get(id);
        if (loc) scene.focusLocation(loc);
      },
      focusOrder: (id) => {
        const path = engine.pickPathFor(id);
        if (path.length > 0) {
          scene.setPath(path);
          scene.setHighlight(path, 0xffc247);
          scene.focusLocation(path[0]!, 34);
        }
      },
      focusVehicle: (id) => {
        const vehicle = engine.vehicles.find((v) => v.id === id);
        if (vehicle) scene.focusPoint({ x: vehicle.x, y: 0, z: vehicle.z } as never, 34);
      },
    };
  }

  /**
   * Release everything the application holds: the incident notices, the
   * listeners on the document and the WebGL context.
   */
  dispose(): void {
    this.incidents?.destroy();
    this.incidents = null;
    this.scene.dispose();
  }

  mount(): void {
    this.applyStaticTranslations();
    this.incidents = mountIncidentHost(document.getElementById('incidents'));
    this.buildRail();
    this.buildLangSwitcher();
    this.bindTopbar();
    this.bindPanels();
    this.bindCanvas();
    this.bindKeys();

    this.renderLeft(true);
    this.renderRight(true);
    this.renderTop(true);
    this.renderStatus(true);

    onLangChange(() => {
      this.applyStaticTranslations();
      this.buildRail();
      this.syncLangSwitcher();
      this.scene.refreshLabels();
      this.renderLeft(true);
      this.renderRight(true);
      this.renderTop(true);
      this.renderStatus(true);
      this.announce();
    });

    this.scene.onFrame((dt) => {
      this.frameCount++;
      const now = performance.now();
      if (now - this.frameTime >= 1000) {
        this.fps = (this.frameCount * 1000) / (now - this.frameTime);
        this.frameCount = 0;
        this.frameTime = now;
      }
      const t0 = performance.now();
      if (t0 - this.lastLeftRender > 700) {
        this.lastLeftRender = t0;
        this.renderLeft();
        this.renderTop();
      }
      if (t0 - this.lastRightRender > 900) {
        this.lastRightRender = t0;
        this.renderRight();
      }
      if (t0 - this.lastTopRender > 400) {
        this.lastTopRender = t0;
        this.renderClock();
      }
      if (t0 - this.lastStatusRender > 1000) {
        this.lastStatusRender = t0;
        this.renderStatus();
      }
      if (t0 - this.lastAnnounce > 10000) {
        this.lastAnnounce = t0;
        this.announce();
      }
      void dt;
    });
  }

  private lastStatusRender = 0;
  private lastAnnounce = 0;

  /** Concise screen-reader summary of the whole operation. */
  private announce(): void {
    const node = document.getElementById('a11y-live');
    if (!node) return;
    const kpi = this.engine.kpi;
    const stages = buildStages(this.engine);
    node.textContent =
      `${t('模擬時間 {0}，', formatClock(this.engine.simTime))}` +
      stages.map((s) => `${s.label} ${s.count}${s.unit}`).join(' · ') +
      `${t('。倉儲利用率 {0}%，', Math.round(kpi.warehouseUtilisation))}` +
      `${t('揀貨準確率 {0}%，', Math.round(kpi.pickAccuracy))}` +
      `${t('在手訂單 {0} 筆。', kpi.openOrders)}`;
  }

  /* ------------------------------------------------------- static chrome */

  /**
   * Apply the active language to everything that is written in `index.html`.
   * Elements opt in through `data-i18n`, `data-i18n-aria` or `data-i18n-title`.
   */
  private applyStaticTranslations(): void {
    document.documentElement.lang = htmlLang();
    document.title = t('NEXUS WMS 3D · 智慧倉儲與物流運輸全流程');
    setMeta('name', 'description', t('NEXUS WMS 3D — 倉儲管理與物流運輸全流程數位孿生：入庫、收貨、上架、儲位、揀貨、打包、裝車、運輸與即時 KPI 看板。'));
    setMeta('property', 'og:title', t('NEXUS WMS 3D · 智慧倉儲與物流運輸全流程'));
    setMeta('property', 'og:description', t('倉儲管理與物流運輸全流程 3D 數位孿生：入庫、收貨、上架、儲位、揀貨、打包、裝車、運輸與即時 KPI 看板。'));
    setMeta('property', 'og:locale', getLang() === 'en' ? 'en_US' : 'zh_TW');
    setMeta('property', 'og:image:alt', t('NEXUS WMS 3D — 倉儲管理與物流運輸全流程數位孿生：入庫、收貨、上架、儲位、揀貨、打包、裝車、運輸與即時 KPI 看板。'));
    setMeta('name', 'twitter:title', t('NEXUS WMS 3D · 智慧倉儲與物流運輸全流程'));
    setMeta(
      'name',
      'twitter:description',
      t('倉儲管理與物流運輸全流程 3D 數位孿生：入庫、收貨、上架、儲位、揀貨、打包、裝車、運輸與即時 KPI 看板。'),
    );

    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
      node.textContent = t(node.dataset.i18n!);
    });
    document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((node) => {
      node.setAttribute('aria-label', t(node.dataset.i18nAria!));
    });
    document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((node) => {
      node.title = t(node.dataset.i18nTitle!);
    });
  }

  /* -------------------------------------------------------------- rail */

  private buildRail(): void {
    this.railEl.innerHTML = '';
    for (const entry of RAIL) {
      const button = el<HTMLButtonElement>('button', 'rail__btn');
      button.type = 'button';
      button.dataset.section = entry.id;
      const label = RAIL_LABELS(entry.id);
      button.title = label;
      button.setAttribute('aria-label', label);
      button.innerHTML = `<svg viewBox="0 0 24 24">${entry.icon}</svg>`;
      button.addEventListener('click', () => this.setSection(entry.id));
      this.railEl.appendChild(button);
    }
    this.syncRail();
  }

  private setSection(section: SectionId): void {
    this.section = section;
    this.filters.search = '';
    this.syncRail();
    this.renderLeft(true);
    this.leftPanel.classList.add('is-open');
  }

  private syncRail(): void {
    this.railEl.querySelectorAll<HTMLButtonElement>('.rail__btn').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.section === this.section);
    });
  }

  /* ------------------------------------------------------ language switch */

  private buildLangSwitcher(): void {
    const host = document.getElementById('lang-switch');
    if (!host) return;
    host.innerHTML = '';
    const options: Array<{ lang: Lang; label: string }> = [
      { lang: 'zh-TW', label: t('中文') },
      { lang: 'en', label: 'EN' },
    ];
    for (const option of options) {
      const button = el<HTMLButtonElement>('button', 'lang__btn');
      button.type = 'button';
      button.dataset.lang = option.lang;
      button.textContent = option.label;
      button.addEventListener('click', () => setLang(option.lang));
      host.appendChild(button);
    }
    this.syncLangSwitcher();
  }

  private syncLangSwitcher(): void {
    const host = document.getElementById('lang-switch');
    if (!host) return;
    const active = getLang();
    host.querySelectorAll<HTMLButtonElement>('.lang__btn').forEach((button) => {
      const isActive = button.dataset.lang === active;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  }

  /* ----------------------------------------------------------- topbar */

  private bindTopbar(): void {
    document.querySelectorAll<HTMLButtonElement>('.speed__btn').forEach((button) => {
      button.addEventListener('click', () => {
        const speed = Number(button.dataset.speed ?? '0');
        this.engine.setSpeed(speed);
        document.querySelectorAll('.speed__btn').forEach((b) => b.classList.remove('is-active'));
        button.classList.add('is-active');
      });
    });
  }

  private renderTop(force = false): void {
    const cards = this.kpiCards();
    if (!force && this.kpiStrip.children.length > 0) {
      const values = this.kpiStrip.querySelectorAll<HTMLElement>('[data-value]');
      cards.forEach((card, i) => {
        const node = values[i];
        if (node) node.innerHTML = card.valueHtml;
      });
      return;
    }
    this.kpiStrip.innerHTML = cards.map((card) => card.html).join('');
  }

  private kpiCards(): Array<{ html: string; valueHtml: string }> {
    const kpi = this.engine.kpi;
    const defs = [
      { label: t('出貨吞吐'), value: fmtInt(kpi.throughputPerHour), unit: t('件/時'), trend: '▲', cls: 'up' },
      { label: t('揀貨準確率'), value: fmt1(kpi.pickAccuracy), unit: '%', trend: '▲', cls: 'up' },
      { label: t('準時出貨'), value: fmt1(kpi.onTimeDelivery), unit: '%', trend: '▲', cls: 'up' },
      { label: t('倉儲利用率'), value: fmtInt(kpi.warehouseUtilisation), unit: '%', trend: '▼', cls: 'flat' },
      { label: t('在手訂單'), value: fmtInt(kpi.openOrders), unit: t('單'), trend: '▲', cls: 'up' },
      { label: t('活躍人力'), value: fmtInt(kpi.activeWorkers), unit: t('人'), trend: '─', cls: 'flat' },
    ];
    return defs.map((def) => {
      const valueHtml = `${esc(def.value)}<small>${esc(def.unit)}</small>`;
      const html = `<div class="kpi"><div class="kpi__label">${esc(def.label)}</div><div class="kpi__value"><span data-value>${valueHtml}</span><span class="kpi__trend ${def.cls}">${esc(
        def.trend,
      )}</span></div></div>`;
      return { html, valueHtml };
    });
  }

  private renderClock(): void {
    this.clockEl.textContent = formatClock(this.engine.simTime);
    this.dateEl.textContent = formatDay(this.engine.simTime);
  }

  /* ----------------------------------------------------------- panels */

  private bindPanels(): void {
    this.leftPanel.addEventListener('click', (event) => this.onLeftClick(event));
    this.leftPanel.addEventListener('input', (event) => this.onLeftInput(event));
    this.rightPanel.addEventListener('click', (event) => this.onRightClick(event));
  }

  private onLeftClick(event: Event): void {
    const target = event.target as HTMLElement;

    const chip = target.closest<HTMLElement>('[data-status],[data-kind],[data-zone]');
    if (chip) {
      if (chip.dataset.status !== undefined) this.filters.orderStatus = chip.dataset.status ?? '';
      if (chip.dataset.kind !== undefined) this.filters.taskKind = chip.dataset.kind ?? '';
      if (chip.dataset.zone !== undefined) this.filters.zone = chip.dataset.zone ?? '';
      this.renderLeft(true);
      return;
    }

    const orderEl = target.closest<HTMLElement>('[data-order]');
    if (orderEl?.dataset.order) {
      this.engine.select('order', orderEl.dataset.order);
      this.renderPathForOrder(orderEl.dataset.order);
      return;
    }
    const waveEl = target.closest<HTMLElement>('[data-wave]');
    if (waveEl?.dataset.wave) {
      this.engine.select('wave', waveEl.dataset.wave);
      this.renderPathForWave(waveEl.dataset.wave);
      return;
    }
    const taskEl = target.closest<HTMLElement>('[data-task]');
    if (taskEl?.dataset.task) {
      this.engine.select('task', taskEl.dataset.task);
      return;
    }
    const locationEl = target.closest<HTMLElement>('[data-location]');
    if (locationEl?.dataset.location) {
      this.engine.select('location', locationEl.dataset.location);
      const loc = this.engine.layout.locations.get(locationEl.dataset.location);
      if (loc) this.scene.focusLocation(loc);
      return;
    }
    const skuEl = target.closest<HTMLElement>('[data-sku]');
    if (skuEl?.dataset.sku) {
      this.engine.select('sku', skuEl.dataset.sku);
      return;
    }
    const shipmentEl = target.closest<HTMLElement>('[data-shipment]');
    if (shipmentEl?.dataset.shipment) {
      this.engine.select('shipment', shipmentEl.dataset.shipment);
      return;
    }
    const vehicleEl = target.closest<HTMLElement>('[data-vehicle]');
    if (vehicleEl?.dataset.vehicle) {
      this.engine.select('none', '');
      this.inspectorActions.focusVehicle(vehicleEl.dataset.vehicle);
      const vehicle = this.engine.vehicles.find((v) => v.id === vehicleEl.dataset.vehicle);
      if (vehicle) this.showVehicleTooltip(vehicle);
      return;
    }
    const asnEl = target.closest<HTMLElement>('[data-asn]');
    if (asnEl?.dataset.asn) {
      const asn = this.engine.asns.find((a) => a.id === asnEl.dataset.asn);
      if (asn) this.scene.focusPoint({ x: asn.lines.length * 2, y: 0, z: -38 } as never, 40);
    }
  }

  private onLeftInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.id === 'inv-search' || target.id === 'order-search') {
      this.filters.search = target.value;
      clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => this.renderLeft(true), 260);
    }
  }

  private searchTimer = 0;

  private onRightClick(event: Event): void {
    const target = event.target as HTMLElement;
    const locationEl = target.closest<HTMLElement>('[data-location]');
    if (locationEl?.dataset.location) {
      this.engine.select('location', locationEl.dataset.location);
      const loc = this.engine.layout.locations.get(locationEl.dataset.location);
      if (loc) this.scene.focusLocation(loc);
      return;
    }
    const orderEl = target.closest<HTMLElement>('[data-order]');
    if (orderEl?.dataset.order) {
      this.engine.select('order', orderEl.dataset.order);
      this.renderPathForOrder(orderEl.dataset.order);
      return;
    }
    const skuEl = target.closest<HTMLElement>('[data-sku]');
    if (skuEl?.dataset.sku) {
      this.engine.select('sku', skuEl.dataset.sku);
    }
  }

  private renderPathForOrder(orderId: string): void {
    const path = this.engine.pickPathFor(orderId);
    if (path.length > 0) {
      this.scene.setPath(path);
      this.scene.setHighlight(path, 0xffc247);
    }
  }

  private renderPathForWave(waveId: string): void {
    const wave = this.engine.waves.get(waveId);
    if (!wave) return;
    const points = [];
    for (const orderId of wave.orderIds) {
      for (const loc of this.engine.pickPathFor(orderId)) points.push(loc);
    }
    if (points.length > 0) {
      this.scene.setPath(points);
      this.scene.setHighlight(points, 0x35e0d0);
    }
  }

  /* ------------------------------------------------------------ canvas */

  private bindCanvas(): void {
    const canvas = this.scene.renderer.domElement;
    let downX = 0;
    let downY = 0;

    canvas.addEventListener('pointerdown', (event) => {
      downX = event.clientX;
      downY = event.clientY;
    });

    canvas.addEventListener('pointerup', (event) => {
      const moved = Math.hypot(event.clientX - downX, event.clientY - downY);
      if (moved > 6) return;
      const result = this.scene.pick(event);
      if (!result) return;
      this.applyPick(result);
    });

    canvas.addEventListener('pointermove', (event) => {
      if (event.buttons !== 0) {
        this.tooltip.hidden = true;
        return;
      }
      const result = this.scene.pick(event);
      if (!result) {
        this.tooltip.hidden = true;
        return;
      }
      this.showTooltip(event, result);
    });

    canvas.addEventListener('pointerleave', () => {
      this.tooltip.hidden = true;
    });
  }

  private applyPick(result: PickResult): void {
    switch (result.kind) {
      case 'location': {
        this.engine.select('location', result.id);
        const loc = this.engine.layout.locations.get(result.id);
        if (loc) {
          this.scene.setHighlight([loc], 0x35e0d0);
          this.scene.focusLocation(loc);
        }
        break;
      }
      case 'vehicle':
        this.engine.select('none', '');
        this.inspectorActions.focusVehicle(result.id);
        break;
      case 'worker': {
        const worker = this.engine.workers.find((w) => w.id === result.id);
        if (worker) {
          this.engine.select('none', '');
          this.scene.focusPoint({ x: worker.x, y: 0, z: worker.z } as never, 22);
        }
        break;
      }
      case 'agv': {
        const agv = this.engine.agvs.find((a) => a.id === result.id);
        if (agv) {
          this.engine.select('none', '');
          this.scene.focusPoint({ x: agv.x, y: 0, z: agv.z } as never, 22);
        }
        break;
      }
      case 'dock': {
        const dock = this.engine.layout.docks.find((d) => d.id === result.id);
        if (dock) this.scene.focusPoint({ x: dock.x, y: 0, z: dock.z } as never, 36);
        break;
      }
      case 'station': {
        const station = this.engine.layout.stations.find((s) => s.id === result.id);
        if (station) this.scene.focusPoint({ x: station.x, y: 0, z: station.z } as never, 30);
        break;
      }
      default:
        break;
    }
    this.renderRight(true);
  }

  private showTooltip(event: PointerEvent, result: PickResult): void {
    let title = '';
    let sub = '';
    switch (result.kind) {
      case 'location': {
        const loc = this.engine.layout.locations.get(result.id);
        if (!loc) return;
        title = loc.id;
        const weight = this.engine.inventory.locationWeight(loc.id);
        const lots = this.engine.inventory.lotsAt(loc.id);
        sub = `${t('{0} 區', loc.zoneId)} · L${loc.level} · ${fmtWeight(weight)} · ${lots.length} ${t('批次')}`;
        break;
      }
      case 'vehicle': {
        const vehicle = this.engine.vehicles.find((v) => v.id === result.id);
        if (!vehicle) return;
        title = vehicle.plate;
        const destination = vehicle.destination
          ? localize(vehicle.destination, vehicle.destinationEn)
          : t('待命');
        sub = `${destination} · ${t('載重 {0}%', fmtInt(vehicle.load * 100))}`;
        break;
      }
      case 'worker': {
        const worker = this.engine.workers.find((w) => w.id === result.id);
        if (!worker) return;
        title = worker.name;
        sub = `${worker.id} · ${t('效率 {0}%', Math.round(worker.skill * 100))}`;
        break;
      }
      case 'agv': {
        const agv = this.engine.agvs.find((a) => a.id === result.id);
        if (!agv) return;
        title = agv.id;
        sub = `${t('電量 {0}%', fmtInt(agv.battery * 100))} · ${AGV_STATE_LABEL(agv.state)}`;
        break;
      }
      case 'dock': {
        const dock = this.engine.layout.docks.find((d) => d.id === result.id);
        if (!dock) return;
        title = dock.id;
        sub = dock.occupiedBy ? t('作業中 {0}', dock.occupiedBy) : t('空閒');
        break;
      }
      case 'station': {
        const station = this.engine.layout.stations.find((s) => s.id === result.id);
        if (!station) return;
        title = stationName(station);
        sub = station.id;
        break;
      }
      default:
        return;
    }

    this.tooltip.innerHTML = `<b>${esc(title)}</b><div class="t2">${esc(sub)}</div>`;
    this.tooltip.hidden = false;
    const pad = 14;
    const rect = this.tooltip.getBoundingClientRect();
    const x = Math.min(event.clientX + pad, window.innerWidth - rect.width - 8);
    const y = Math.min(event.clientY + pad, window.innerHeight - rect.height - 8);
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y}px`;
  }

  private showVehicleTooltip(vehicle: { plate: string; destination: string; destinationEn: string }): void {
    const destination = vehicle.destination
      ? localize(vehicle.destination, vehicle.destinationEn)
      : t('待命');
    this.tooltip.innerHTML = `<b>${esc(vehicle.plate)}</b><div class="t2">${esc(destination)}</div>`;
    this.tooltip.hidden = false;
    this.tooltip.style.left = '50%';
    this.tooltip.style.top = '120px';
    window.setTimeout(() => {
      this.tooltip.hidden = true;
    }, 2200);
  }

  /* ------------------------------------------------------------- keys */

  private bindKeys(): void {
    window.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      const preset = PRESET_KEYS[event.key];
      if (preset) {
        this.scene.setPreset(preset);
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        const pause = this.engine.speed === 0;
        this.engine.setSpeed(pause ? 4 : 0);
        document.querySelectorAll('.speed__btn').forEach((b) => {
          const speed = Number((b as HTMLButtonElement).dataset.speed ?? '0');
          b.classList.toggle('is-active', speed === (pause ? 4 : 0));
        });
        return;
      }
      if (event.key.toLowerCase() === 'f') {
        const sel = this.engine.selection;
        if (sel.kind === 'location') {
          const loc = this.engine.layout.locations.get(sel.id);
          if (loc) this.scene.focusLocation(loc);
        }
      }
    });
  }

  /* ----------------------------------------------------------- render */

  private renderLeft(force = false): void {
    const active = document.activeElement as HTMLElement | null;
    const focusId = active && this.leftPanel.contains(active) ? active.id : '';
    const caret = focusId && active instanceof HTMLInputElement ? active.selectionStart : null;

    let result;
    switch (this.section) {
      case 'overview':
        result = renderOverview(this.engine);
        break;
      case 'inbound':
        result = renderInbound(this.engine);
        break;
      case 'inventory':
        result = renderInventory(this.engine, this.filters);
        break;
      case 'orders':
        result = renderOrders(this.engine, this.filters);
        break;
      case 'tasks':
        result = renderTasks(this.engine, this.filters);
        break;
      case 'transport':
        result = renderTransport(this.engine);
        break;
    }

    // Keep the scroll position and DOM stable when nothing actually changed.
    const scrollTop = this.leftPanel.scrollTop;
    if (!force && result.html === this.lastLeftHtml) return;
    this.lastLeftHtml = result.html;
    // The panel owns its heading (h2); the sections inside it are h3. The
    // heading is prepended here rather than overwriting the first section's
    // title, which would destroy that section's own name.
    this.leftPanel.innerHTML =
      `<div class="panel__head"><h2 class="panel__title">${esc(sectionTitle(this.section))}</h2></div>` +
      result.html;
    result.after?.(this.leftPanel);
    this.leftPanel.scrollTop = scrollTop;

    if (focusId) {
      const restored = document.getElementById(focusId) as HTMLInputElement | null;
      if (restored) {
        restored.focus();
        if (caret !== null && restored.setSelectionRange) {
          try {
            restored.setSelectionRange(caret, caret);
          } catch {
            /* ignore unsupported selection ranges */
          }
        }
      }
    }
  }

  private lastLeftHtml = '';

  private renderRight(force = false): void {
    const html = renderInspector(this.engine, this.inspectorActions);
    const scrollTop = this.rightPanel.scrollTop;
    if (!force && html === this.lastRightHtml) return;
    this.lastRightHtml = html;
    // The panel heading is fixed ("Details"); the blocks inside it are h3 and
    // carry the name of whatever is currently selected.
    this.rightPanel.innerHTML =
      `<div class="panel__head"><h2 class="panel__title">${esc(t('詳情'))}</h2></div>` + html;
    bindInspectorActions(this.rightPanel, this.engine, this.inspectorActions);
    this.rightPanel.scrollTop = scrollTop;
  }

  private lastRightHtml = '';

  private renderStatus(force = false): void {
    const engine = this.engine;
    const activeTasks = engine.activeTaskCount();
    const busyWorkers = engine.workers.filter((w) => w.busyTaskId).length;
    const movingVehicles = engine.vehicles.filter((v) => v.status !== 'idle').length;

    this.statusEl.innerHTML = `
      <span><span class="status-led"></span><b>${t('數位孿生運作中')}</b></span>
      <span>${t('模擬時間')} <b>${esc(formatClock(engine.simTime))}</b> · ${t('速度')} <b>${
        engine.speed === 0 ? t('暫停') : `${engine.speed}×`
      }</b></span>
      <span>${t('進行中任務')} <b>${activeTasks}</b></span>
      <span class="status__optional">${t('作業中人員')} <b>${busyWorkers}/${engine.workers.length}</b></span>
      <span class="status__optional">${t('在途車輛')} <b>${movingVehicles}</b></span>
      <span class="status__optional">${t('在途訂單')} <b>${engine.kpi.openOrders}</b></span>
      <span class="spacer"></span>
      <span class="status__optional">${t('庫存')} <b>${esc(fmtCompact(engine.inventory.totalUnits()))}</b> ${t('件')}</span>
      <span>${t('渲染')} <b>${Math.round(this.fps)}</b> FPS</span>
      <span class="status__optional">${t('1–6 視角 · 空白暫停 · 點選貨位查看明細')}</span>
    `;
    void force;
  }
}

function setMeta(attribute: 'name' | 'property', key: string, content: string): void {
  const node = document.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (node) node.content = content;
}


