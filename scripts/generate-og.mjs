/**
 * Open Graph / Twitter card generator.
 *
 * Renders `public/og.png` (1200x630) — the preview image that GitHub, Slack, X,
 * Discord and LinkedIn show when the project link is shared.
 *
 *   npm run og
 *
 * The artwork is drawn with the same design tokens as the app (light theme,
 * accent #276bb9) so the card and the product read as one thing. Everything is
 * vector: no external fonts, images or assets are fetched.
 *
 * `sharp` is deliberately NOT a dependency of the project — it is only needed to
 * *regenerate* the card, and the generated PNG is committed to the repository.
 * The project itself stays at three runtime dependencies (three.js) plus a few
 * dev tools, so `npm ci` stays fast for contributors.
 *
 *   npm i -D sharp && npm run og
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error(
    '✗ sharp is not installed.\n' +
      '  It is only needed to regenerate this image:\n' +
      '      npm i -D sharp && npm run og\n' +
      '  The committed public/og.png needs no regeneration.',
  );
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outFile = resolve(root, 'public', 'og.png');

const W = 1200;
const H = 630;

/* ------------------------------------------------------------- design tokens */

const C = {
  bg0: '#ffffff',
  bg1: '#f6fafe',
  bg2: '#eaf3fc',
  accent: '#276bb9',
  accentSoft: '#3377c4',
  accentDeep: '#1d5691',
  ink: '#0f3050',
  ink2: '#1c3f5e',
  ink3: '#4d6b87',
  line: '#d5e5f5',
  ok: '#1c8039',
  warn: '#9a6a06',
  amber: '#e2a92b',
  rack: '#c9dcef',
  rackDark: '#9fb9d6',
  carton: '#d8a566',
  cartonDark: '#bd8a4c',
};

/* ------------------------------------------------------------------ isometric */

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

/** Project a 3D point (x, y, z) onto the 2D card. */
function iso(x, y, z, ox, oy) {
  return {
    x: ox + (x - y) * COS30,
    y: oy + (x + y) * SIN30 - z,
  };
}

const pts = (arr) => arr.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

/**
 * An isometric box: three visible faces (top, left, right).
 */
function box(x, y, z, w, d, h, ox, oy, colors) {
  const p = (dx, dy, dz) => iso(x + dx, y + dy, z + dz, ox, oy);
  const top = [p(0, 0, h), p(w, 0, h), p(w, d, h), p(0, d, h)];
  const left = [p(0, d, h), p(w, d, h), p(w, d, 0), p(0, d, 0)];
  const right = [p(w, 0, h), p(w, d, h), p(w, d, 0), p(w, 0, 0)];
  return `
    <polygon points="${pts(right)}" fill="${colors.right}"/>
    <polygon points="${pts(left)}" fill="${colors.left}"/>
    <polygon points="${pts(top)}" fill="${colors.top}"/>`;
}

/* -------------------------------------------------------------- scene drawing */

/** A racking bay: uprights, three shelf levels, cartons on the shelves. */
function rack(x, y, z, bays, levels, ox, oy) {
  let out = '';
  const bayW = 22;
  const bayD = 16;
  const levelH = 20;

  for (let b = 0; b < bays; b += 1) {
    for (let l = 0; l < levels; l += 1) {
      const shade = l % 2 === 0 ? C.carton : C.cartonDark;
      const top = l === levels - 1 ? shade : C.cartonDark;
      out += box(
        x + b * (bayW + 2),
        y,
        z + l * (levelH + 2),
        bayW,
        bayD,
        levelH - 4,
        ox,
        oy,
        { top, left: C.rackDark, right: C.cartonDark },
      );
    }
    // upright
    const u = box(
      x + b * (bayW + 2) + bayW + 1,
      y,
      z,
      1.5,
      bayD + 1,
      levels * (levelH + 2),
      ox,
      oy,
      { top: C.rack, left: C.rackDark, right: C.rack },
    );
    out += u;
  }
  return out;
}

function buildScene() {
  const ox = 845;
  const oy = 168;
  let s = '';

  // floor slab
  const floor = [
    iso(0, 0, 0, ox, oy),
    iso(290, 0, 0, ox, oy),
    iso(290, 190, 0, ox, oy),
    iso(0, 190, 0, ox, oy),
  ];
  s += `<polygon points="${pts(floor)}" fill="${C.bg2}" stroke="${C.line}" stroke-width="1.5"/>`;

  // back rack row
  s += rack(0, 0, 0, 9, 3, ox, oy);

  // mid rack row (shorter)
  s += rack(24, 54, 0, 7, 2, ox, oy);

  // conveyor spine
  const conv = [
    iso(20, 116, 0, ox, oy),
    iso(280, 116, 0, ox, oy),
    iso(280, 132, 0, ox, oy),
    iso(20, 132, 0, ox, oy),
  ];
  s += `<polygon points="${pts(conv)}" fill="${C.rack}" stroke="${C.rackDark}" stroke-width="1"/>`;
  for (let i = 0; i < 14; i += 1) {
    const c = box(28 + i * 18, 118, 6, 11, 10, 9, ox, oy, {
      top: C.accentSoft,
      left: C.accentDeep,
      right: C.accent,
    });
    s += c;
  }

  // AGV on the floor
  s += box(120, 150, 0, 34, 22, 13, ox, oy, {
    top: '#ffffff',
    left: C.accentDeep,
    right: C.accent,
  });
  // carried pallet
  s += box(128, 154, 13, 18, 14, 8, ox, oy, {
    top: C.carton,
    left: C.cartonDark,
    right: C.cartonDark,
  });

  // truck at the dock
  s += box(214, 14, 0, 58, 26, 26, ox, oy, {
    top: '#ffffff',
    left: C.accentDeep,
    right: C.accent,
  });
  s += box(214, 14, 26, 25, 26, 12, ox, oy, {
    top: '#dbe9f8',
    left: C.rackDark,
    right: C.rack,
  });

  // pallet + goods on the floor near the dock
  s += box(192, 96, 0, 20, 16, 12, ox, oy, {
    top: C.carton,
    left: C.cartonDark,
    right: C.cartonDark,
  });

  return s;
}

/* ------------------------------------------------------------------ the card */

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${C.bg0}"/>
      <stop offset="100%" stop-color="${C.bg1}"/>
    </linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.accentSoft}"/>
      <stop offset="100%" stop-color="${C.accentDeep}"/>
    </linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.bg0}" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="${C.bg0}" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="frame"><rect width="${W}" height="${H}"/></clipPath>
  </defs>

  <g clip-path="url(#frame)">
    <rect width="${W}" height="${H}" fill="url(#bg)"/>

    <!-- faint blueprint grid -->
    <g stroke="${C.line}" stroke-width="1" opacity="0.5">
      ${Array.from({ length: 30 }, (_, i) => `<line x1="${i * 40}" y1="0" x2="${i * 40}" y2="${H}"/>`).join('')}
      ${Array.from({ length: 16 }, (_, i) => `<line x1="0" y1="${i * 40}" x2="${W}" y2="${i * 40}"/>`).join('')}
    </g>

    <!-- left accent bar -->
    <rect x="0" y="0" width="14" height="${H}" fill="url(#bar)"/>

    <!-- isometric scene on the right -->
    ${buildScene()}
    <rect x="700" y="0" width="130" height="${H}" fill="url(#fade)"/>

    <!-- brand mark -->
    <g transform="translate(78,92)">
      <rect width="76" height="76" rx="18" fill="${C.accent}"/>
      <g fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round">
        <path d="M21 55V29"/>
        <path d="M38 55V18"/>
        <path d="M55 55V36"/>
      </g>
    </g>

    <text x="78" y="248" font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif" font-size="66" font-weight="700" fill="${C.ink}">NEXUS WMS 3D</text>

    <text x="78" y="310" font-family="Microsoft JhengHei, PingFang TC, Noto Sans TC, Segoe UI, sans-serif" font-size="33" font-weight="600" fill="${C.ink2}">智慧倉儲與物流運輸全流程數位孿生</text>

    <text x="78" y="356" font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif" font-size="25" fill="${C.ink3}">Smart Warehousing &amp; Transport · End to End</text>

    <!-- feature chips, 2x2 so they never collide with the scene on the right -->
    <g font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif" font-size="18" font-weight="600">
      ${[
        ['11 stages', 'zh-TW / EN'],
        ['1,800+ bins', 'WMS + TMS'],
      ]
        .flatMap(([a, b], row) =>
          [a, b].map((label, col) => {
            const x = 78 + col * 212;
            const y = 384 + row * 56;
            return `<g transform="translate(${x},${y})">
              <rect width="200" height="44" rx="22" fill="${C.bg2}" stroke="${C.line}" stroke-width="1.5"/>
              <circle cx="24" cy="22" r="5" fill="${C.ok}"/>
              <text x="40" y="29" fill="${C.ink2}">${label}</text>
            </g>`;
          }),
        )
        .join('')}
    </g>

    <!-- footer -->
    <line x1="78" y1="510" x2="690" y2="510" stroke="${C.line}" stroke-width="1.5"/>
    <text x="78" y="552" font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif" font-size="22" font-weight="600" fill="${C.ink2}">MIT · TypeScript · three.js · zero backend</text>
    <text x="78" y="586" font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif" font-size="19" fill="${C.ink3}">Event-driven simulation engine — every 3D movement is a domain rule, not an animation.</text>
  </g>
</svg>`;

mkdirSync(dirname(outFile), { recursive: true });
await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: false }).toFile(outFile);

const { size } = await import('node:fs').then((fs) => fs.statSync(outFile));
console.log(`✓ wrote public/og.png — ${W}x${H}, ${(size / 1024).toFixed(0)} KB`);
