/**
 * Runtime user preferences.
 *
 * The stylesheet honours `prefers-reduced-motion` for the interface itself.
 * The 3D camera has to honour it as well: the eased flight from one viewpoint
 * to another is a decorative transition, and someone who asked the operating
 * system to reduce motion did not ask for the warehouse to swing across the
 * screen.
 *
 * The simulation keeps running either way — the movement of the trucks and the
 * AGVs *is* the content, not an animation.
 */

/** Whether the operator asked the system to reduce motion. */
export function prefersReducedMotion(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    // A browser that refuses to answer is treated as "no preference".
    return false;
  }
}
