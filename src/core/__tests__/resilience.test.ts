/**
 * Runtime resilience unit tests.
 *
 * These cover the parts of the failure path that are easy to get subtly wrong:
 * a hot loop that must not flood the log, a guard that has to know when to give
 * up, and a context-loss handler that has to cancel the event or the browser
 * will never restore the context.
 */

import { describe, expect, it } from 'vitest';
import { bindContextRecovery, IncidentLog, LoopGuard } from '../resilience';

describe('incident log', () => {
  it('accepts the first report of an incident kind', () => {
    const log = new IncidentLog();
    expect(log.report({ id: 'context-lost', severity: 'warning' })).toBe(true);
    expect(log.incidents).toHaveLength(1);
    expect(log.incidents[0]!.id).toBe('context-lost');
    expect(log.incidents[0]!.severity).toBe('warning');
  });

  it('suppresses a repeated report inside the throttle window', () => {
    let now = 1_000;
    const log = new IncidentLog({ throttleMs: 500, now: () => now });
    expect(log.report({ id: 'x', severity: 'warning' })).toBe(true);
    now += 100;
    expect(log.report({ id: 'x', severity: 'warning' })).toBe(false);
    expect(log.incidents).toHaveLength(1);
  });

  it('accepts a repeated report once the throttle window has passed', () => {
    let now = 1_000;
    const log = new IncidentLog({ throttleMs: 500, now: () => now });
    log.report({ id: 'x', severity: 'warning' });
    now += 600;
    expect(log.report({ id: 'x', severity: 'warning' })).toBe(true);
    expect(log.incidents).toHaveLength(2);
  });

  it('keeps different incident kinds apart', () => {
    const log = new IncidentLog();
    expect(log.report({ id: 'a', severity: 'info' })).toBe(true);
    expect(log.report({ id: 'b', severity: 'info' })).toBe(true);
    expect(log.incidents).toHaveLength(2);
  });

  it('notifies subscribers and stops after unsubscribing', () => {
    const log = new IncidentLog();
    const seen: string[] = [];
    const off = log.subscribe((incident) => seen.push(incident.id));
    log.report({ id: 'a', severity: 'info' });
    off();
    log.report({ id: 'b', severity: 'info' });
    expect(seen).toEqual(['a']);
  });

  it('bounds how many incidents it keeps', () => {
    const log = new IncidentLog({ limit: 3, throttleMs: 0 });
    for (const id of ['a', 'b', 'c', 'd', 'e']) log.report({ id, severity: 'info' });
    expect(log.incidents).toHaveLength(3);
    expect(log.incidents[0]!.id).toBe('c');
  });

  it('keeps the technical detail verbatim', () => {
    const log = new IncidentLog();
    log.report({ id: 'a', severity: 'error', detail: 'TypeError: x is not a function' });
    expect(log.incidents[0]!.detail).toBe('TypeError: x is not a function');
  });
});

describe('loop guard', () => {
  it('keeps running after a single failure', () => {
    const log = new IncidentLog();
    const guard = new LoopGuard({ log, maxConsecutiveFailures: 3 });
    let calls = 0;
    const task = (): void => {
      calls++;
      if (calls === 1) throw new Error('boom');
    };
    expect(guard.run(task)).toBe(false);
    expect(guard.failures).toBe(1);
    expect(guard.run(task)).toBe(true);
    expect(guard.healthy).toBe(true);
    expect(guard.failures).toBe(0);
  });

  it('reports a recoverable incident for the first failure', () => {
    const log = new IncidentLog();
    const guard = new LoopGuard({ log, maxConsecutiveFailures: 3, recoverableId: 'loop-error' });
    guard.run(() => {
      throw new Error('boom');
    });
    expect(log.incidents).toHaveLength(1);
    expect(log.incidents[0]!.id).toBe('loop-error');
    expect(log.incidents[0]!.severity).toBe('warning');
    expect(log.incidents[0]!.detail).toBe('boom');
  });

  it('declares the loop dead after a run of failures', () => {
    const log = new IncidentLog();
    const guard = new LoopGuard({
      log,
      maxConsecutiveFailures: 3,
      recoverableId: 'loop-error',
      fatalId: 'loop-fatal',
    });
    for (let i = 0; i < 3; i++) {
      guard.run(() => {
        throw new Error('boom');
      });
    }
    expect(guard.healthy).toBe(false);
    const fatal = log.incidents.find((incident) => incident.id === 'loop-fatal');
    expect(fatal).toBeDefined();
    expect(fatal!.severity).toBe('error');
  });

  it('does not run a dead loop again', () => {
    const log = new IncidentLog();
    const guard = new LoopGuard({ log, maxConsecutiveFailures: 1 });
    let calls = 0;
    guard.run(() => {
      calls++;
      throw new Error('boom');
    });
    expect(
      guard.run(() => {
        calls++;
      }),
    ).toBe(false);
    expect(calls).toBe(1);
  });

  it('does not flood the log when every frame fails', () => {
    // The throttle is what keeps a 60 fps failure from becoming 60 reports.
    const log = new IncidentLog({ throttleMs: 5000 });
    const guard = new LoopGuard({ log, maxConsecutiveFailures: 1000 });
    for (let i = 0; i < 200; i++) {
      guard.run(() => {
        throw new Error('boom');
      });
    }
    expect(log.incidents.filter((incident) => incident.id === 'loop-error')).toHaveLength(1);
  });
});

describe('gpu context recovery', () => {
  it('cancels the loss event so the browser can restore the context', () => {
    const canvas = new EventTarget();
    let lost = 0;
    bindContextRecovery(canvas, {
      onLost: () => {
        lost++;
      },
      onRestored: () => undefined,
    });
    const event = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(event);
    expect(lost).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('reports the restoration', () => {
    const canvas = new EventTarget();
    let restored = 0;
    bindContextRecovery(canvas, {
      onLost: () => undefined,
      onRestored: () => {
        restored++;
      },
    });
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(restored).toBe(1);
  });

  it('stops listening once it is unbound', () => {
    const canvas = new EventTarget();
    let lost = 0;
    const unbind = bindContextRecovery(canvas, {
      onLost: () => {
        lost++;
      },
      onRestored: () => undefined,
    });
    unbind();
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(lost).toBe(0);
  });
});
