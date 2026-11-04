// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { SimulationEngine } from '../../domain/engine';
import { App } from '../app';

/**
 * Accessibility audit of the rendered interface.
 *
 * `scripts/contrast-audit.mjs` checks the colours of the design tokens. This
 * suite checks the structure of the DOM the operator actually ends up with —
 * the rules a screen-reader user depends on and that a colour audit can never
 * catch.
 *
 * The application is mounted for real (same engine, same UI modules) with the
 * 3D renderer replaced by a stub, because the audit is about document
 * structure rather than about WebGL.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');

/**
 * happy-dom does not implement the canvas 2D context, and the charts module
 * draws onto one. A no-op context is enough: the audit inspects the DOM, not
 * the pixels.
 *
 * The stub is installed on the prototype so that canvases created *after* the
 * application mounts — the charts are built during the first render — are
 * covered too.
 */
function stubCanvasContext(): void {
  const noop = () => undefined;
  const context = {
    setTransform: noop,
    resetTransform: noop,
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    fillText: noop,
    strokeText: noop,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
  };

  const proto = window.HTMLCanvasElement.prototype as unknown as {
    getContext: (type: string) => unknown;
  };
  proto.getContext = () => context;
}

/** The parts of `WarehouseScene` that the UI layer touches. */
const sceneStub = {
  renderer: { domElement: null as unknown },
  onFrame() {},
  refreshLabels() {},
  focusLocation() {},
  focusPoint() {},
  setPath() {},
  setHighlight() {},
  setPreset() {},
  pick() {
    return null;
  },
};

let app: App;

beforeAll(() => {
  // Start from the real `index.html` shell so the audit sees the same document
  // the browser parses, then let the application populate it.
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
  // Drop the module script tag: happy-dom refuses to load JavaScript modules,
  // and the UI is mounted by this test rather than by the entry point.
  document.body.innerHTML = body.replace(/<script\b[\s\S]*?<\/script>/g, '');

  const canvas = document.getElementById('scene');
  if (canvas) {
    sceneStub.renderer.domElement = canvas;
  }
  stubCanvasContext();

  const engine = new SimulationEngine(20240101);
  engine.bootstrap();

  app = new App(engine, sceneStub as never);
  app.mount();
});

/**
 * The accessible name of an element, following the order the spec uses:
 * `aria-labelledby`, then `aria-label`, then a `<label>`, then the text
 * content, then `title`.
 */
function accessibleName(element: Element): string {
  const doc = element.ownerDocument;

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const names = labelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean);
    if (names.length > 0) return names.join(' ');
  }

  const ariaLabel = element.getAttribute('aria-label')?.trim();
  if (ariaLabel) return ariaLabel;

  const id = element.getAttribute('id');
  if (id) {
    const label = doc.querySelector(`label[for="${id}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }

  const wrapping = element.closest('label');
  if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();

  const text = element.textContent?.trim();
  if (text) return text;

  return element.getAttribute('title')?.trim() ?? '';
}

/** Elements a keyboard user can reach, skipping anything hidden. */
function isHidden(element: Element): boolean {
  if (element.hasAttribute('hidden')) return true;
  if (element.getAttribute('aria-hidden') === 'true') return true;
  if (element.closest('[hidden]')) return true;
  const style = (element as HTMLElement).style;
  return style.display === 'none' || style.visibility === 'hidden';
}

describe('document language', () => {
  it('declares the interface language on the html element', () => {
    const lang = document.documentElement.getAttribute('lang');
    expect(lang).toBeTruthy();
    expect(lang).toMatch(/^[a-z]{2}(-[A-Za-z0-9]+)*$/);
  });
});

describe('accessible names', () => {
  it('gives every interactive control an accessible name', () => {
    const controls = document.querySelectorAll(
      'button, a[href], input, select, textarea, [role="button"], [role="link"]',
    );
    expect(controls.length).toBeGreaterThan(0);

    const unnamed: string[] = [];
    for (const control of controls) {
      if (isHidden(control)) continue;
      const type = control.getAttribute('type');
      if (control.tagName === 'INPUT' && (type === 'submit' || type === 'reset')) continue;
      if (accessibleName(control).length === 0) {
        unnamed.push(`<${control.tagName.toLowerCase()} class="${control.className}">`);
      }
    }
    expect(unnamed, `controls without an accessible name:\n${unnamed.join('\n')}`).toEqual([]);
  });

  it('gives every image an alt attribute', () => {
    const missing: string[] = [];
    for (const image of document.querySelectorAll('img')) {
      if (!image.hasAttribute('alt')) missing.push(image.getAttribute('src') ?? '<unknown>');
    }
    expect(missing, `images without alt: ${missing.join(', ')}`).toEqual([]);
  });

  it('labels or hides every inline graphic', () => {
    const problems: string[] = [];
    for (const svg of document.querySelectorAll('svg')) {
      const labelled = svg.getAttribute('aria-label') || svg.getAttribute('aria-labelledby');
      const hidden = svg.getAttribute('aria-hidden') === 'true';
      const role = svg.getAttribute('role');
      const inControl = svg.closest('button, a[href], [role="button"]');
      if (!labelled && !hidden && role !== 'img' && !inControl) {
        problems.push(svg.outerHTML.slice(0, 60));
      }
    }
    expect(problems, `unlabelled svg: ${problems.join(', ')}`).toEqual([]);
  });

  it('labels every form control', () => {
    const problems: string[] = [];
    for (const control of document.querySelectorAll('input, select, textarea')) {
      const id = control.getAttribute('id');
      const labelled =
        control.getAttribute('aria-label') ||
        control.getAttribute('aria-labelledby') ||
        (id ? document.querySelector(`label[for="${id}"]`) : null) ||
        control.closest('label');
      if (!labelled) problems.push(`<${control.tagName.toLowerCase()} id="${id ?? '-'}">`);
    }
    expect(problems, `unlabelled form controls: ${problems.join(', ')}`).toEqual([]);
  });
});

describe('document structure', () => {
  it('has exactly one h1', () => {
    expect(document.querySelectorAll('h1')).toHaveLength(1);
  });

  it('does not skip heading levels', () => {
    const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')];
    const skips: string[] = [];
    let previous = 0;
    for (const heading of headings) {
      const level = Number(heading.tagName.slice(1));
      if (previous > 0 && level > previous + 1) {
        skips.push(`h${previous} → h${level} ("${heading.textContent?.trim().slice(0, 30)}")`);
      }
      previous = level;
    }
    expect(skips, `skipped heading levels: ${skips.join(', ')}`).toEqual([]);
  });

  it('resolves every ARIA id reference', () => {
    const broken: string[] = [];
    for (const attribute of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns']) {
      for (const element of document.querySelectorAll(`[${attribute}]`)) {
        for (const id of element.getAttribute(attribute)!.split(/\s+/).filter(Boolean)) {
          if (!document.getElementById(id)) {
            broken.push(`<${element.tagName.toLowerCase()} ${attribute}="${id}">`);
          }
        }
      }
    }
    expect(broken, `broken ARIA references: ${broken.join(', ')}`).toEqual([]);
  });
});

describe('live regions and landmarks', () => {
  it('provides a polite live region for announcements', () => {
    const regions = document.querySelectorAll('[aria-live]');
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      expect(['polite', 'assertive']).toContain(region.getAttribute('aria-live'));
    }
  });

  it('provides named landmarks', () => {
    const landmarks = document.querySelectorAll(
      'header, nav, main, aside, footer, [role="banner"], [role="navigation"], [role="main"], [role="complementary"], [role="contentinfo"]',
    );
    expect(landmarks.length).toBeGreaterThanOrEqual(3);

    const unnamed: string[] = [];
    for (const landmark of landmarks) {
      const name =
        landmark.getAttribute('aria-label') ||
        landmark.getAttribute('aria-labelledby') ||
        landmark.textContent?.trim();
      if (!name) unnamed.push(landmark.tagName.toLowerCase());
    }
    expect(unnamed, `unnamed landmarks: ${unnamed.join(', ')}`).toEqual([]);
  });
});

describe('keyboard operation', () => {
  it('keeps every rail button in the tab order', () => {
    const buttons = document.querySelectorAll('.rail__btn');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.getAttribute('tabindex')).not.toBe('-1');
    }
  });

  it('keeps every rail button focusable and labelled', () => {
    for (const button of document.querySelectorAll('.rail__btn')) {
      expect(accessibleName(button).length).toBeGreaterThan(0);
      expect(button.tagName).toBe('BUTTON');
    }
  });
});
