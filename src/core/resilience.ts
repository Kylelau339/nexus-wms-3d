/**
 * Runtime resilience primitives.
 *
 * A digital twin is expected to run on whatever machine the operator happens to
 * have: a laptop that switches between two GPUs, a virtual machine without
 * hardware acceleration, a browser tab that sat in the background for an hour.
 * None of those are bugs in the simulation, but every one of them can break
 * the render loop or leave the screen silently frozen — which for an
 * operations dashboard is the worst possible failure mode, because a frozen
 * dashboard still *looks* like a working one.
 *
 * The rules this module enforces:
 *
 *   - a failing frame must not become sixty error reports per second,
 *   - a lost GPU context must be visible, not silently blank,
 *   - every failure reaches the operator as a notice they can read and act on.
 *
 * The module has no DOM and no Three.js dependency, so it stays unit-testable
 * in isolation and can be used from any layer of the application.
 */

export type Severity = 'info' | 'warning' | 'error';

/** A runtime problem the operator needs to know about. */
export interface Incident {
  /** Stable machine key, e.g. `context-lost`. Also the de-duplication key. */
  id: string;
  severity: Severity;
  /** Technical detail — an exception message, a driver hint. Never translated. */
  detail?: string;
  /** Timestamp in milliseconds. */
  at: number;
}

export type IncidentListener = (incident: Incident) => void;

export interface IncidentLogOptions {
  /** Minimum milliseconds between two accepted reports of the same id. */
  throttleMs?: number;
  /** How many incidents are kept in memory. */
  limit?: number;
  /** Clock source, injectable so tests stay deterministic. */
  now?: () => number;
}

/**
 * A bounded, throttled log of runtime incidents.
 *
 * Throttling is what makes this safe to call from a hot loop: a subsystem that
 * fails on every frame still produces one notice, not one per frame.
 */
export class IncidentLog {
  private readonly throttleMs: number;
  private readonly limit: number;
  private readonly now: () => number;
  private readonly listeners = new Set<IncidentListener>();
  private readonly lastAccepted = new Map<string, number>();
  private readonly items: Incident[] = [];

  constructor(options: IncidentLogOptions = {}) {
    this.throttleMs = options.throttleMs ?? 5000;
    this.limit = options.limit ?? 50;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Record an incident.
   *
   * Returns `false` when the report was suppressed as a duplicate, so a caller
   * in a hot loop can tell that nobody needs to react to it again.
   */
  report(input: { id: string; severity: Severity; detail?: string; at?: number }): boolean {
    const at = input.at ?? this.now();
    const previous = this.lastAccepted.get(input.id);
    if (previous !== undefined && at - previous < this.throttleMs) return false;

    this.lastAccepted.set(input.id, at);
    const incident: Incident = { id: input.id, severity: input.severity, at };
    if (input.detail !== undefined) incident.detail = input.detail;

    this.items.push(incident);
    if (this.items.length > this.limit) {
      this.items.splice(0, this.items.length - this.limit);
    }
    for (const listener of [...this.listeners]) listener(incident);
    return true;
  }

  /** Subscribe to new incidents. Returns an unsubscribe function. */
  subscribe(listener: IncidentListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The incidents recorded so far, oldest first. */
  get incidents(): readonly Incident[] {
    return this.items;
  }

  /** Forget every recorded incident. */
  clear(): void {
    this.items.length = 0;
    this.lastAccepted.clear();
  }
}

export interface LoopGuardOptions {
  log: IncidentLog;
  /** Consecutive failures tolerated before the loop is declared dead. */
  maxConsecutiveFailures?: number;
  /** Incident id reported for a failure the loop can recover from. */
  recoverableId?: string;
  /** Incident id reported once the loop has been declared dead. */
  fatalId?: string;
}

/**
 * Guards a per-frame callback.
 *
 * A single throwing frame must not kill the loop, and a permanently throwing
 * loop must not spin the console at the frame rate. The guard therefore
 * tolerates a run of failures, reports the first one as recoverable, and
 * declares the loop dead once the run is long enough to be unambiguous.
 */
export class LoopGuard {
  private consecutiveFailures = 0;
  private dead = false;

  constructor(private readonly options: LoopGuardOptions) {}

  /** Consecutive failures since the last successful iteration. */
  get failures(): number {
    return this.consecutiveFailures;
  }

  /** False once the loop has been declared dead and should not run again. */
  get healthy(): boolean {
    return !this.dead;
  }

  /**
   * Run one iteration.
   *
   * Returns true when the iteration completed without throwing.
   */
  run(task: () => void): boolean {
    if (this.dead) return false;

    try {
      task();
      this.consecutiveFailures = 0;
      return true;
    } catch (error) {
      this.consecutiveFailures++;
      const detail = error instanceof Error ? error.message : String(error);
      const max = this.options.maxConsecutiveFailures ?? 30;

      if (this.consecutiveFailures >= max) {
        this.dead = true;
        this.options.log.report({
          id: this.options.fatalId ?? 'loop-fatal',
          severity: 'error',
          detail,
        });
      } else {
        this.options.log.report({
          id: this.options.recoverableId ?? 'loop-error',
          severity: 'warning',
          detail,
        });
      }
      return false;
    }
  }
}

export interface ContextRecoveryHandlers {
  onLost: (event: Event) => void;
  onRestored: (event: Event) => void;
}

/**
 * Watch a canvas for GPU context loss and restoration.
 *
 * The browser only attempts to restore a context when the `webglcontextlost`
 * event is cancelled, so the handler has to call `preventDefault()`. The
 * returned function removes both listeners again.
 */
export function bindContextRecovery(
  canvas: EventTarget,
  handlers: ContextRecoveryHandlers,
): () => void {
  const onLost = (event: Event): void => {
    event.preventDefault();
    handlers.onLost(event);
  };
  const onRestored = (event: Event): void => {
    handlers.onRestored(event);
  };

  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return () => {
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
  };
}

/** The application-wide incident log. */
export const incidents = new IncidentLog();
