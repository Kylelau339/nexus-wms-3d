// @vitest-environment happy-dom

/**
 * Runtime preference tests.
 *
 * The 3D camera eases from one viewpoint to another. Someone who asked the
 * operating system to reduce motion did not ask for the warehouse to swing
 * across the screen, so the flight has to be skipped — and the check has to
 * survive a browser that cannot answer the question.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion } from '../preferences';

const original = window.matchMedia;

afterEach(() => {
  window.matchMedia = original;
  vi.restoreAllMocks();
});

function stubMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }) as unknown as typeof window.matchMedia;
}

describe('reduced motion preference', () => {
  it('reports the preference when the browser answers', () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it('reports no preference when the browser says no', () => {
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('asks the right question', () => {
    stubMatchMedia(false);
    prefersReducedMotion();
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('treats a browser without matchMedia as no preference', () => {
    // @ts-expect-error — simulating a browser without the API.
    delete window.matchMedia;
    expect(prefersReducedMotion()).toBe(false);
  });

  it('survives a browser that throws', () => {
    window.matchMedia = vi.fn().mockImplementation(() => {
      throw new Error('nope');
    }) as unknown as typeof window.matchMedia;
    expect(prefersReducedMotion()).toBe(false);
  });
});
