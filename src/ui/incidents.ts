/**
 * Runtime incident notices.
 *
 * Every failure the resilience layer detects ends up here, as a small notice
 * the operator can read and dismiss. The wording lives in the translation
 * dictionary, so a notice reads in the same language as the rest of the
 * interface — including after a language switch, because the notices are
 * re-rendered rather than frozen at creation time.
 */

import { labelTable, onLangChange, t } from '../core/i18n';
import { incidents, type Incident, type IncidentLog } from '../core/resilience';
import { el } from './dom';

/**
 * The headline for each incident kind.
 *
 * The ids are the machine keys used by the resilience layer; the values are
 * the Traditional Chinese source strings, which are also the dictionary keys.
 */
const INCIDENT_TEXT = labelTable({
  'context-lost': '顯示引擎已暫停，正在等待 GPU 恢復',
  'context-restored': '顯示引擎已恢復',
  'loop-error': '畫面更新發生錯誤，已自動重試',
  'loop-fatal': '畫面更新已停止，請重新整理頁面',
  'runtime-error': '發生未預期的錯誤',
  'runtime-rejection': '發生未預期的錯誤',
  unknown: '發生未預期的錯誤',
});

/** How long a notice stays on screen before it closes itself. */
const LIFETIME = { info: 6000, warning: 14000 } as const;

/** How many notices are visible at once. */
const MAX_VISIBLE = 3;

/** Resolve the headline of an incident, falling back to the generic wording. */
function incidentTitle(id: string): string {
  const text = INCIDENT_TEXT(id);
  return text === id ? INCIDENT_TEXT('unknown') : text;
}

export interface IncidentHost {
  /** Remove the notices and stop listening for new ones. */
  destroy(): void;
}

/**
 * Render the incident notices into a host element.
 *
 * One notice per incident kind: a subsystem that keeps failing updates the
 * existing notice instead of stacking a wall of identical cards.
 */
export function mountIncidentHost(
  host: HTMLElement | null,
  log: IncidentLog = incidents,
): IncidentHost {
  if (!host) return { destroy: () => undefined };

  const rendered = new Map<string, HTMLElement>();

  const dismiss = (id: string): void => {
    const node = rendered.get(id);
    if (!node) return;
    node.remove();
    rendered.delete(id);
  };

  const show = (incident: Incident): void => {
    dismiss(incident.id);

    const node = el('div', `incident incident--${incident.severity}`);
    // Errors interrupt; everything else waits for a pause in the operator's
    // work. The severity decides which one it is.
    node.setAttribute('role', incident.severity === 'error' ? 'alert' : 'status');

    const body = el('div', 'incident__body');
    const title = el('strong', 'incident__title');
    title.textContent = incidentTitle(incident.id);
    body.appendChild(title);

    if (incident.detail) {
      const detail = el('span', 'incident__detail');
      detail.textContent = incident.detail;
      body.appendChild(detail);
    }
    node.appendChild(body);

    const close = el<HTMLButtonElement>('button', 'incident__close');
    close.type = 'button';
    close.setAttribute('aria-label', t('關閉'));
    close.textContent = '✕';
    close.addEventListener('click', () => dismiss(incident.id));
    node.appendChild(close);

    host.appendChild(node);
    rendered.set(incident.id, node);

    while (rendered.size > MAX_VISIBLE) {
      const oldest = rendered.keys().next();
      if (oldest.done) break;
      dismiss(oldest.value);
    }

    const lifetime = LIFETIME[incident.severity as keyof typeof LIFETIME];
    if (lifetime !== undefined) {
      window.setTimeout(() => dismiss(incident.id), lifetime);
    }
  };

  // Notices raised before the interface was ready are still worth showing.
  for (const incident of log.incidents) show(incident);
  const unsubscribe = log.subscribe(show);

  const unsubscribeLang = onLangChange(() => {
    for (const [id, node] of rendered) {
      const title = node.querySelector('.incident__title');
      if (title) title.textContent = incidentTitle(id);
      const close = node.querySelector('.incident__close');
      if (close) close.setAttribute('aria-label', t('關閉'));
    }
  });

  return {
    destroy(): void {
      unsubscribe();
      unsubscribeLang();
      host.replaceChildren();
      rendered.clear();
    },
  };
}
