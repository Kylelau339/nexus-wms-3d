// @vitest-environment happy-dom

/**
 * Incident notice tests.
 *
 * The notices are the only way a runtime failure reaches the operator, so the
 * chain is checked end to end: an incident is reported, it becomes a visible
 * card, it reads in the active language, and the operator can dismiss it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLang } from '../../core/i18n';
import { IncidentLog } from '../../core/resilience';
import { mountIncidentHost } from '../incidents';

let host: HTMLDivElement;
let log: IncidentLog;

beforeEach(() => {
  setLang('zh-TW');
  document.body.innerHTML = '<div id="incidents" aria-live="polite"></div>';
  host = document.getElementById('incidents') as HTMLDivElement;
  log = new IncidentLog();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('incident notices', () => {
  it('shows a notice when an incident is reported', () => {
    mountIncidentHost(host, log);
    log.report({ id: 'context-lost', severity: 'warning' });

    const notices = host.querySelectorAll('.incident');
    expect(notices).toHaveLength(1);
    expect(notices[0]!.className).toContain('incident--warning');
    expect(host.querySelector('.incident__title')?.textContent).toBe(
      '顯示引擎已暫停，正在等待 GPU 恢復',
    );
  });

  it('shows the notices that were raised before the interface was ready', () => {
    log.report({ id: 'context-lost', severity: 'warning' });
    mountIncidentHost(host, log);
    expect(host.querySelectorAll('.incident')).toHaveLength(1);
  });

  it('reads in the active language and follows a language switch', () => {
    mountIncidentHost(host, log);
    log.report({ id: 'context-lost', severity: 'warning' });
    expect(host.querySelector('.incident__title')?.textContent).toContain('GPU');

    setLang('en');
    expect(host.querySelector('.incident__title')?.textContent).toBe(
      'Rendering paused, waiting for the GPU to recover',
    );
  });

  it('lets the operator dismiss a notice', () => {
    mountIncidentHost(host, log);
    log.report({ id: 'context-lost', severity: 'warning' });

    const close = host.querySelector('.incident__close') as HTMLButtonElement;
    expect(close).toBeTruthy();
    close.click();
    expect(host.querySelectorAll('.incident')).toHaveLength(0);
  });

  it('gives the dismiss button an accessible name in both languages', () => {
    mountIncidentHost(host, log);
    log.report({ id: 'context-lost', severity: 'warning' });

    const close = host.querySelector('.incident__close') as HTMLButtonElement;
    expect(close.getAttribute('aria-label')).toBe('關閉');

    setLang('en');
    expect(close.getAttribute('aria-label')).toBe('Close');
  });

  it('replaces a repeated notice instead of stacking identical cards', () => {
    mountIncidentHost(host, log);
    log.report({ id: 'context-lost', severity: 'warning' });
    log.report({ id: 'context-lost', severity: 'warning' });
    expect(host.querySelectorAll('.incident')).toHaveLength(1);
  });

  it('interrupts with an alert for an error and stays quiet for a notice', () => {
    mountIncidentHost(host, log);
    log.report({ id: 'runtime-error', severity: 'error' });
    log.report({ id: 'context-restored', severity: 'info' });

    const roles = [...host.querySelectorAll('.incident')].map((node) => node.getAttribute('role'));
    expect(roles).toContain('alert');
    expect(roles).toContain('status');
  });

  it('shows the technical detail of a failure', () => {
    mountIncidentHost(host, log);
    log.report({ id: 'runtime-error', severity: 'error', detail: 'TypeError: x is not a function' });
    expect(host.querySelector('.incident__detail')?.textContent).toBe(
      'TypeError: x is not a function',
    );
  });

  it('falls back to the generic wording for an unknown incident kind', () => {
    mountIncidentHost(host, log);
    log.report({ id: 'something-new', severity: 'warning' });
    expect(host.querySelector('.incident__title')?.textContent).toBe('發生未預期的錯誤');
  });
});
