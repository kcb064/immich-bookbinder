// Generates the Claude Design artboards for immich-bookbinder.
// Run: node design/gen.mjs  -> writes design/app-ui/* and design/book-templates/*
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(here, 'app-ui');
const BOOK_DIR = join(here, 'book-templates');
mkdirSync(APP_DIR, { recursive: true });
mkdirSync(BOOK_DIR, { recursive: true });

// ---------------------------------------------------------------- shared
const wrap = (fonts, css, body) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}&display=swap">
  <style>
    body { margin: 0; }
    ${css}
  </style>
</helmet>
${body}
</x-dc>
</body>
</html>
`;

const TONES = {
  sea: 'linear-gradient(180deg, #9cc3d4 0%, #4f7f97 55%, #27475a 100%)',
  dusk: 'linear-gradient(180deg, #f3c39a 0%, #c46b7c 50%, #443456 100%)',
  forest: 'linear-gradient(180deg, #d3dfc9 0%, #5f8a5a 55%, #22381f 100%)',
  stone: 'linear-gradient(180deg, #ebe5dc 0%, #a89c8c 60%, #574e45 100%)',
  tile: 'linear-gradient(135deg, #e4ecf1 0%, #6f95b8 50%, #2b4a6e 100%)',
  street: 'linear-gradient(180deg, #f5e9cf 0%, #c98a54 55%, #55392a 100%)',
  portrait: 'linear-gradient(180deg, #f4e1d2 0%, #c9a08a 55%, #654437 100%)',
  night: 'linear-gradient(180deg, #1c2340 0%, #3d4178 55%, #0c0f1f 100%)',
  gold: 'linear-gradient(180deg, #f7e6c2 0%, #d9a45b 55%, #6e4a23 100%)',
  moss: 'linear-gradient(180deg, #e3e9d6 0%, #8ea56c 55%, #3b4a2a 100%)',
};
const SCENES = {
  hills: `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position: absolute; inset: 0; width: 100%; height: 100%;"><path d="M0 68 Q 22 48 48 64 T 100 58 V100 H0 Z" fill="rgba(18,28,30,0.42)"></path><path d="M0 82 Q 30 68 60 80 T 100 74 V100 H0 Z" fill="rgba(8,14,14,0.55)"></path></svg>`,
  sea: `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position: absolute; inset: 0; width: 100%; height: 100%;"><circle cx="70" cy="36" r="7" fill="rgba(255,240,210,0.85)"></circle><rect x="0" y="56" width="100" height="44" fill="rgba(10,30,40,0.35)"></rect><rect x="0" y="56" width="100" height="0.6" fill="rgba(255,255,255,0.45)"></rect></svg>`,
  city: `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position: absolute; inset: 0; width: 100%; height: 100%;"><path d="M0 100 V70 H8 V58 H16 V66 H24 V50 H30 V62 H40 V72 H48 V54 H56 V64 H64 V46 H70 V60 H80 V68 H88 V56 H94 V70 H100 V100 Z" fill="rgba(20,20,30,0.55)"></path></svg>`,
  person: `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position: absolute; inset: 0; width: 100%; height: 100%;"><ellipse cx="50" cy="38" rx="11" ry="14" fill="rgba(60,35,30,0.45)"></ellipse><path d="M22 100 Q 26 62 50 60 Q 74 62 78 100 Z" fill="rgba(60,35,30,0.5)"></path></svg>`,
  pet: `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position: absolute; inset: 0; width: 100%; height: 100%;"><ellipse cx="50" cy="72" rx="26" ry="16" fill="rgba(70,45,30,0.5)"></ellipse><circle cx="72" cy="52" r="12" fill="rgba(70,45,30,0.55)"></circle><path d="M62 42 L66 30 L72 42 Z M78 42 L82 30 L86 42 Z" fill="rgba(70,45,30,0.55)"></path></svg>`,
  none: '',
};
const photo = (tone, style = '', scene = 'none') =>
  `<div style="position: relative; overflow: hidden; background: ${TONES[tone]}; box-shadow: inset 0 0 90px rgba(0,0,0,0.16); ${style}">${SCENES[scene]}</div>`;

// stroke icons, 18px grid
const ICON = {
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"></path><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>',
  plus: '<path d="M12 5v14M5 12h14"></path>',
  users: '<circle cx="9" cy="8" r="3.5"></circle><path d="M2.5 20a6.5 6.5 0 0 1 13 0"></path><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-5-6.3"></path>',
  settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path>',
  map: '<path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3z"></path><path d="M9 3v15M15 6v15"></path>',
  search: '<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path>',
  download: '<path d="M12 3v12M6.5 10.5L12 16l5.5-5.5"></path><path d="M4 20h16"></path>',
  check: '<path d="M4 12.5l5 5L20 6.5"></path>',
  warn: '<path d="M12 3l10 18H2z"></path><path d="M12 10v5M12 18.5v.5"></path>',
  undo: '<path d="M9 14L4 9l5-5"></path><path d="M4 9h10a6 6 0 0 1 0 12h-3"></path>',
  redo: '<path d="M15 14l5-5-5-5"></path><path d="M20 9H10a6 6 0 0 0 0 12h3"></path>',
  chevR: '<path d="M9 5l7 7-7 7"></path>',
  chevL: '<path d="M15 5l-7 7 7 7"></path>',
  album: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 16l5-5 4 4 3-3 6 6"></path><circle cx="16" cy="9" r="1.5"></circle>',
  paw: '<circle cx="8" cy="8" r="2"></circle><circle cx="16" cy="8" r="2"></circle><circle cx="4.5" cy="13" r="2"></circle><circle cx="19.5" cy="13" r="2"></circle><path d="M12 12c-3.5 0-6 3-6 5.5A2.5 2.5 0 0 0 8.5 20h7a2.5 2.5 0 0 0 2.5-2.5C18 15 15.5 12 12 12z"></path>',
  sparkle: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"></path>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle>',
  print: '<path d="M6 9V3h12v6"></path><rect x="3" y="9" width="18" height="9" rx="2"></rect><path d="M6 15h12v6H6z"></path>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"></path><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"></path>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect>',
  x: '<path d="M6 6l12 12M18 6L6 18"></path>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"></path>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path>',
  pin: '<path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z"></path><circle cx="12" cy="9" r="2.5"></circle>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M3 10h18M10 10v11"></path>',
  qr: '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect><path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 21v-2M21 14v2"></path>',
};
const icon = (name, size = 18, color = 'currentColor', extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="flex: none; ${extra}">${ICON[name]}</svg>`;

// ================================================================ CANVAS A: APP UI
const A = {
  bg: '#0f1115', side: '#12151b', surface: '#171a21', surface2: '#1e222b', border: '#2a2f3a',
  text: '#e8eaf0', muted: '#8d95a7', faint: '#5c6476', accent: '#7c8cff', accentDeep: '#5563e8',
  ok: '#4cc38a', warn: '#f2b350', danger: '#ef6b74',
};
const APP_FONTS = 'family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500';
const APP_CSS = `
    a { color: ${A.accent}; text-decoration: none; } a:hover { color: #a3aeff; }
    .app { width: 1440px; height: 900px; display: flex; background: ${A.bg}; color: ${A.text}; font-family: 'Instrument Sans', system-ui, sans-serif; font-size: 14px; line-height: 1.4; overflow: hidden; }
    .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .side { width: 232px; flex: none; background: ${A.side}; border-right: 1px solid ${A.border}; display: flex; flex-direction: column; padding: 20px 14px; gap: 6px; }
    .nav { display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 12px; border-radius: 8px; color: ${A.muted}; font-weight: 500; }
    .nav.on { background: ${A.surface2}; color: ${A.text}; }
    .main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .top { height: 64px; flex: none; display: flex; align-items: center; justify-content: space-between; padding: 0 28px; border-bottom: 1px solid ${A.border}; }
    .h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
    .btn { display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 18px; border-radius: 9px; font-weight: 600; font-size: 14px; border: 1px solid ${A.border}; background: ${A.surface2}; color: ${A.text}; }
    .btn.primary { background: ${A.accentDeep}; border-color: ${A.accentDeep}; color: #fff; }
    .btn.ghost { background: transparent; }
    .card { background: ${A.surface}; border: 1px solid ${A.border}; border-radius: 12px; }
    .chip { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .label { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${A.faint}; }
    .field { height: 44px; display: flex; align-items: center; gap: 10px; padding: 0 14px; border-radius: 9px; background: ${A.bg}; border: 1px solid ${A.border}; color: ${A.text}; }
    .muted { color: ${A.muted}; }
    .bar { height: 6px; border-radius: 3px; background: ${A.surface2}; overflow: hidden; }
    .bar > div { height: 100%; border-radius: 3px; background: ${A.accent}; }
`;

const sidebar = (active) => {
  const item = (key, name, ic) => `<div class="nav${active === key ? ' on' : ''}">${icon(ic, 18)}<span>${name}</span></div>`;
  return `<div class="side">
    <div style="display: flex; align-items: center; gap: 10px; padding: 4px 12px 18px;">
      <div style="width: 30px; height: 30px; border-radius: 8px; background: ${A.accentDeep}; display: flex; align-items: center; justify-content: center;">${icon('book', 18, '#fff')}</div>
      <div style="font-weight: 700; font-size: 15px; letter-spacing: -0.01em;">Bookbinder</div>
    </div>
    ${item('books', 'Books', 'book')}
    ${item('new', 'New book', 'plus')}
    ${item('people', 'People &amp; pets', 'users')}
    ${item('orders', 'Orders', 'print')}
    ${item('settings', 'Settings', 'settings')}
    <div style="flex: 1;"></div>
    <div class="card" style="padding: 12px 14px; display: flex; flex-direction: column; gap: 6px;">
      <div style="display: flex; align-items: center; gap: 8px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: ${A.ok};"></span><span style="font-weight: 600; font-size: 13px;">Immich connected</span></div>
      <div class="muted" style="font-size: 12px;">immich_server:2283 · v3.2.0</div>
      <div class="muted" style="font-size: 12px;">48,210 photos · 6 people</div>
    </div>
  </div>`;
};

const statusChip = (kind, text) => {
  const c = { draft: [A.muted, A.surface2], ok: [A.ok, 'rgba(76,195,138,0.14)'], warn: [A.warn, 'rgba(242,179,80,0.14)'], accent: [A.accent, 'rgba(124,140,255,0.16)'] }[kind];
  return `<span class="chip" style="color: ${c[0]}; background: ${c[1]};">${text}</span>`;
};

// --- Dashboard
const bookCard = (title, meta, chip, tone, scene, style) => `
  <div class="card" style="overflow: hidden; display: flex; flex-direction: column;">
    <div style="aspect-ratio: 1; position: relative; display: flex; align-items: flex-end; padding: 18px; background: ${style === 'gallery' ? '#fafaf8' : '#f4eee3'};">
      ${photo(tone, `position: absolute; inset: ${style === 'gallery' ? '18px 18px 64px 18px' : '0'};`, scene)}
      <div style="position: relative; font-family: ${style === 'gallery' ? "'Instrument Sans', sans-serif" : "Georgia, serif"}; font-size: ${style === 'gallery' ? '11px' : '22px'}; ${style === 'gallery' ? 'letter-spacing: 0.14em; text-transform: uppercase; color: #333;' : 'font-style: italic; color: #fff8ec;'}">${title}</div>
    </div>
    <div style="padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 8px;">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;"><div style="font-weight: 600; font-size: 15px;">${title}</div>${chip}</div>
      <div class="muted" style="font-size: 12.5px;">${meta}</div>
    </div>
  </div>`;

const miniMap = (dots) => `<svg width="120" height="84" viewBox="0 0 120 84" style="flex: none; border-radius: 8px; background: ${A.surface2};">
  <path d="M6 60 C 20 40, 30 70, 50 50 S 90 30, 114 44" stroke="${A.border}" stroke-width="1.5" fill="none"></path>
  <path d="M0 22 C 25 10, 60 28, 120 12" stroke="${A.border}" stroke-width="1.5" fill="none"></path>
  ${dots.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="rgba(124,140,255,0.35)" stroke="${A.accent}" stroke-width="1.5"></circle>`).join('')}
</svg>`;

const tripCard = (title, meta, dots) => `
  <div class="card" style="display: flex; gap: 16px; padding: 14px; align-items: center;">
    ${miniMap(dots)}
    <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
      <div style="font-weight: 600; font-size: 15px;">${title}</div>
      <div class="muted" style="font-size: 12.5px;">${meta}</div>
      <div style="margin-top: 8px; display: flex; align-items: center; gap: 4px; color: ${A.accent}; font-weight: 600; font-size: 13px; height: 44px;">Make a book ${icon('chevR', 16)}</div>
    </div>
  </div>`;

const Dashboard = wrap(APP_FONTS, APP_CSS, `<div class="app">
  ${sidebar('books')}
  <div class="main">
    <div class="top"><div class="h1">Books</div><div class="btn primary">${icon('plus', 18, '#fff')}New book</div></div>
    <div style="padding: 28px; display: flex; flex-direction: column; gap: 32px; overflow: hidden;">
      <div style="display: flex; flex-direction: column; gap: 14px;">
        <div class="label">Your books</div>
        <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px;">
          ${bookCard('Portugal', '48 pages · 8.5 × 8.5 in · Hardcover', statusChip('accent', 'Editing'), 'tile', 'city', 'editorial')}
          ${bookCard('Year in review 2025', '96 pages · 8.5 × 11 in · Hardcover', statusChip('ok', 'Shipped'), 'dusk', 'hills', 'gallery')}
          ${bookCard("Mabel's first year", '32 pages · 7.5 × 7.5 in · Softcover', statusChip('warn', 'Rendering'), 'gold', 'pet', 'gallery')}
          ${bookCard("Grandma's 80th", '40 pages · 8.5 × 8.5 in · Linen wrap', statusChip('draft', 'Draft'), 'portrait', 'person', 'editorial')}
        </div>
      </div>
    </div>
  </div>
</div>`);

// --- New book wizard
const stepRail = (active) => {
  const steps = ['Source', 'Refine', 'Size &amp; style', 'Review'];
  return `<div style="display: flex; align-items: center; gap: 12px;">${steps.map((s, i) => `
    <div style="display: flex; align-items: center; gap: 10px; ${i > 0 ? `padding-left: 12px; border-left: 1px solid ${A.border};` : ''}">
      <div style="width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; background: ${i === active ? A.accentDeep : A.surface2}; color: ${i === active ? '#fff' : A.muted};">${i + 1}</div>
      <div style="font-weight: 600; color: ${i === active ? A.text : A.muted};">${s}</div>
    </div>`).join('')}</div>`;
};
const sourceTile = (ic, title, desc, on) => `
  <div class="card" style="padding: 18px; display: flex; flex-direction: column; gap: 10px; ${on ? `border-color: ${A.accent}; box-shadow: 0 0 0 1px ${A.accent} inset;` : ''}">
    <div style="display: flex; justify-content: space-between; align-items: center;">${icon(ic, 22, on ? A.accent : A.muted)}${on ? `<span style="width: 18px; height: 18px; border-radius: 50%; background: ${A.accent}; display: inline-flex; align-items: center; justify-content: center;">${icon('check', 12, '#fff')}</span>` : ''}</div>
    <div style="font-weight: 600; font-size: 15px;">${title}</div>
    <div class="muted" style="font-size: 12.5px; line-height: 1.45;">${desc}</div>
  </div>`;
const personChip = (name, tone, scene = 'person', extra = '') => `<span class="chip" style="height: 32px; padding: 0 12px 0 4px; background: ${A.surface2}; color: ${A.text}; gap: 8px; ${extra}">${photo(tone, 'width: 24px; height: 24px; border-radius: 50%;', scene)}${name}</span>`;

const NewBook = wrap(APP_FONTS, APP_CSS, `<div class="app">
  ${sidebar('new')}
  <div class="main">
    <div class="top"><div class="h1">New book</div>${stepRail(0)}</div>
    <div style="padding: 28px; display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 28px; overflow: hidden;">
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div class="label">Where do the photos come from?</div>
          <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px;">
            ${sourceTile('album', 'Album', 'Pick one or more Immich albums.', false)}
            ${sourceTile('map', 'Trip', 'A date range and the places you were. Finds photos that never made it into an album.', true)}
            ${sourceTile('users', 'People &amp; pets', 'Everything with chosen people, or a pet you have taught the app to find.', false)}
            ${sourceTile('sparkle', 'Smart search', 'Describe it: “sunsets over water”, “kids at the beach”.', false)}
          </div>
        </div>
        <div class="card" style="padding: 16px 18px; display: flex; align-items: center; gap: 14px; border-color: rgba(124,140,255,0.5); background: rgba(124,140,255,0.08);">
          ${icon('sparkle', 20, A.accent)}
          <div style="flex: 1;"><span style="font-weight: 600;">Looks like a trip:</span> <span>Lisbon &amp; Porto, May 12–21, 2026 · 1,240 photos away from home</span></div>
          <div class="btn" style="height: 40px;">Use these dates</div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px;">
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div class="label">Dates</div>
            <div style="display: flex; gap: 10px;">
              <div class="field" style="flex: 1;">${icon('calendar', 16, A.muted)}<span>May 10, 2026</span></div>
              <div class="field" style="flex: 1;">${icon('calendar', 16, A.muted)}<span>May 22, 2026</span></div>
            </div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div class="label">Places</div>
            <div class="field" style="gap: 8px; flex-wrap: wrap; height: auto; min-height: 44px; padding: 6px 10px;">
              <span class="chip" style="height: 30px; background: ${A.surface2}; color: ${A.text};">${icon('pin', 14, A.accent)}Lisbon, Portugal ${icon('x', 12, A.muted)}</span>
              <span class="chip" style="height: 30px; background: ${A.surface2}; color: ${A.text};">${icon('pin', 14, A.accent)}Porto, Portugal ${icon('x', 12, A.muted)}</span>
              <span class="muted">Add a place or pick on the map…</span>
            </div>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px;">
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div class="label">Include</div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              ${personChip('Kevin', 'portrait')}${personChip('Sam', 'stone')}${personChip('Mabel', 'gold', 'pet')}
              <span class="chip" style="height: 32px; background: transparent; border: 1px dashed ${A.border}; color: ${A.muted};">${icon('plus', 14)}Person or pet</span>
            </div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div class="label">Also</div>
            <div style="display: flex; gap: 14px; flex-wrap: wrap; align-items: center; min-height: 44px;">
              <label style="display: flex; align-items: center; gap: 8px;"><span style="width: 18px; height: 18px; border-radius: 5px; background: ${A.accentDeep}; display: inline-flex; align-items: center; justify-content: center;">${icon('check', 12, '#fff')}</span>Favorites always in</label>
              <label style="display: flex; align-items: center; gap: 8px;"><span style="width: 18px; height: 18px; border-radius: 5px; background: ${A.accentDeep}; display: inline-flex; align-items: center; justify-content: center;">${icon('check', 12, '#fff')}</span>Collapse bursts</label>
              <label style="display: flex; align-items: center; gap: 8px;"><span style="width: 18px; height: 18px; border-radius: 5px; border: 1px solid ${A.border};"></span>Include videos (stills)</label>
            </div>
          </div>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div class="card" style="padding: 20px; display: flex; flex-direction: column; gap: 16px;">
          <div class="label">Live estimate</div>
          <div><div style="font-size: 34px; font-weight: 700; letter-spacing: -0.02em;">1,240</div><div class="muted">photos match</div></div>
          <div class="bar"><div style="width: 15%;"></div></div>
          <div style="display: flex; justify-content: space-between;"><span class="muted">Will be picked</span><span style="font-weight: 600;">≈ 182</span></div>
          <div style="display: flex; justify-content: space-between;"><span class="muted">Pages</span><span style="font-weight: 600;">48 <span class="muted">(24–800)</span></span></div>
          <div style="display: flex; justify-content: space-between;"><span class="muted">Near-duplicates collapsed</span><span style="font-weight: 600;">311</span></div>
          <div style="display: flex; justify-content: space-between;"><span class="muted">Days · places</span><span style="font-weight: 600;">10 · 3</span></div>
          <div style="height: 1px; background: ${A.border};"></div>
          <div class="muted" style="font-size: 12.5px; line-height: 1.5;">You can change every pick later. Nothing is fetched from Immich until you continue.</div>
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end;"><div class="btn ghost">Back</div><div class="btn primary">Continue ${icon('chevR', 16, '#fff')}</div></div>
      </div>
    </div>
  </div>
</div>`);

// --- Trip picker (map clusters)
const TripPicker = wrap(APP_FONTS, APP_CSS, `<div class="app">
  ${sidebar('new')}
  <div class="main">
    <div class="top"><div class="h1">Which places were the trip?</div>${stepRail(1)}</div>
    <div style="flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 380px; min-height: 0;">
      <div style="position: relative; background: #121620; overflow: hidden;">
        <svg viewBox="0 0 1000 800" preserveAspectRatio="xMidYMid slice" style="position: absolute; inset: 0; width: 100%; height: 100%;">
          <rect width="1000" height="800" fill="#121620"></rect>
          <path d="M120 80 C 260 40, 420 120, 520 60 S 780 20, 960 110 L 1000 0 L 0 0 Z" fill="#171c28"></path>
          <path d="M0 800 L 0 420 C 120 380, 220 470, 340 430 S 560 380, 700 470 S 900 520, 1000 480 L 1000 800 Z" fill="#171c28"></path>
          <path d="M300 430 C 330 300, 420 260, 470 180 S 560 120, 640 160" stroke="#232a3a" stroke-width="2" fill="none"></path>
          <path d="M0 300 C 150 280, 260 330, 380 300 S 620 260, 1000 300" stroke="#232a3a" stroke-width="1.5" fill="none" stroke-dasharray="6 6"></path>
          <g>
            <circle cx="420" cy="470" r="54" fill="rgba(124,140,255,0.22)" stroke="#7c8cff" stroke-width="2"></circle>
            <text x="420" y="466" text-anchor="middle" fill="#e8eaf0" font-family="Instrument Sans, sans-serif" font-weight="700" font-size="22">812</text>
            <text x="420" y="488" text-anchor="middle" fill="#8d95a7" font-family="Instrument Sans, sans-serif" font-size="13">Lisbon</text>
          </g>
          <g>
            <circle cx="470" cy="250" r="40" fill="rgba(124,140,255,0.22)" stroke="#7c8cff" stroke-width="2"></circle>
            <text x="470" y="247" text-anchor="middle" fill="#e8eaf0" font-family="Instrument Sans, sans-serif" font-weight="700" font-size="20">391</text>
            <text x="470" y="268" text-anchor="middle" fill="#8d95a7" font-family="Instrument Sans, sans-serif" font-size="13">Porto</text>
          </g>
          <g>
            <circle cx="360" cy="500" r="20" fill="rgba(124,140,255,0.22)" stroke="#7c8cff" stroke-width="2"></circle>
            <text x="360" y="505" text-anchor="middle" fill="#e8eaf0" font-family="Instrument Sans, sans-serif" font-weight="700" font-size="14">37</text>
          </g>
          <g opacity="0.5">
            <circle cx="820" cy="140" r="16" fill="rgba(141,149,167,0.2)" stroke="#8d95a7" stroke-width="1.5" stroke-dasharray="4 3"></circle>
            <text x="820" y="145" text-anchor="middle" fill="#8d95a7" font-family="Instrument Sans, sans-serif" font-weight="700" font-size="12">8</text>
          </g>
        </svg>
        <div style="position: absolute; left: 24px; top: 20px; display: flex; gap: 8px;">
          <span class="chip" style="height: 36px; padding: 0 12px; background: rgba(23,26,33,0.9); color: ${A.text}; border: 1px solid ${A.border};">${icon('calendar', 14, A.muted)}May 10 – 22, 2026</span>
          <span class="chip" style="height: 36px; padding: 0 12px; background: rgba(23,26,33,0.9); color: ${A.text}; border: 1px solid ${A.border};">Cluster radius 25 km</span>
        </div>
        <div style="position: absolute; left: 24px; bottom: 20px; display: flex; align-items: center; gap: 10px; color: ${A.muted}; font-size: 12.5px;">${icon('pin', 14, A.muted)}Drag on the map to add an area · Clusters come from Immich map markers</div>
      </div>
      <div style="border-left: 1px solid ${A.border}; padding: 24px; display: flex; flex-direction: column; gap: 14px; background: ${A.side};">
        <div class="label">Clusters in this range</div>
        ${[['Lisbon', 'May 12–16 · 812 photos · Kevin, Sam', true], ['Porto', 'May 16–19 · 391 photos · Kevin, Sam', true], ['Sintra', 'May 14 · 37 photos', true], ['Madrid airport', 'May 21 · 8 photos · layover', false]].map(([n, m, on]) => `
          <div class="card" style="display: flex; align-items: center; gap: 14px; padding: 12px 14px; min-height: 44px; ${on ? '' : 'opacity: 0.6;'}">
            <span style="width: 20px; height: 20px; border-radius: 6px; ${on ? `background: ${A.accentDeep};` : `border: 1px solid ${A.border};`} display: inline-flex; align-items: center; justify-content: center;">${on ? icon('check', 13, '#fff') : ''}</span>
            <div style="flex: 1;"><div style="font-weight: 600;">${n}</div><div class="muted" style="font-size: 12.5px;">${m}</div></div>
          </div>`).join('')}
        <div class="card" style="display: flex; align-items: center; gap: 14px; padding: 12px 14px; border-style: dashed; opacity: 0.7;">
          <span style="width: 20px; height: 20px; border-radius: 6px; border: 1px solid ${A.border};"></span>
          <div style="flex: 1;"><div style="font-weight: 600;">Home · Raleigh</div><div class="muted" style="font-size: 12.5px;">May 10–11, 22 · 1,102 photos · excluded as home</div></div>
        </div>
        <div style="flex: 1;"></div>
        <div style="display: flex; justify-content: space-between; align-items: center;"><span class="muted">1,240 photos selected</span></div>
        <div style="display: flex; gap: 10px;"><div class="btn ghost" style="flex: 1; justify-content: center;">Back</div><div class="btn primary" style="flex: 1; justify-content: center;">Continue ${icon('chevR', 16, '#fff')}</div></div>
      </div>
    </div>
  </div>
</div>`);

// --- Selection review
const scoreChip = (v, extra = '') => `<span class="chip mono" style="position: absolute; left: 8px; bottom: 8px; height: 22px; padding: 0 7px; background: rgba(10,12,16,0.75); color: #fff; font-size: 11.5px; ${extra}">${v}</span>`;
const thumb = (tone, scene, score, opts = {}) => `
  <div style="position: relative; aspect-ratio: 3 / 2; border-radius: 8px; overflow: hidden; ${opts.selected ? `outline: 2px solid ${A.accent}; outline-offset: 2px;` : ''} ${opts.dim ? 'opacity: 0.45;' : ''}">
    ${photo(tone, 'position: absolute; inset: 0;', scene)}
    ${scoreChip(score)}
    ${opts.dup ? `<span class="chip" style="position: absolute; right: 8px; top: 8px; height: 22px; background: rgba(10,12,16,0.75); color: #fff; font-size: 11px;">${icon('grid', 12, '#fff')}${opts.dup}</span>` : ''}
    ${opts.fav ? `<span style="position: absolute; right: 8px; bottom: 8px; color: #fff;">${icon('sparkle', 14, '#fff')}</span>` : ''}
    ${opts.people ? `<span class="chip" style="position: absolute; left: 8px; top: 8px; height: 22px; background: rgba(10,12,16,0.75); color: #fff; font-size: 11px;">${opts.people}</span>` : ''}
  </div>`;
const scoreRow = (name, v, pct) => `<div style="display: grid; grid-template-columns: 90px 1fr 40px; align-items: center; gap: 12px;"><span class="muted" style="font-size: 12.5px;">${name}</span><div class="bar"><div style="width: ${pct}%;"></div></div><span class="mono" style="font-size: 12px; text-align: right;">${v}</span></div>`;
const weight = (name, pct) => `<div style="display: flex; flex-direction: column; gap: 6px;"><div style="display: flex; justify-content: space-between; font-size: 12.5px;"><span>${name}</span><span class="muted mono">${pct}</span></div><div style="position: relative; height: 16px; display: flex; align-items: center;"><div class="bar" style="width: 100%;"><div style="width: ${pct}%;"></div></div><span style="position: absolute; top: 0; left: calc(${pct}% - 8px); width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.4);"></span></div></div>`;

const Review = wrap(APP_FONTS, APP_CSS, `<div class="app">
  ${sidebar('new')}
  <div class="main">
    <div class="top">
      <div style="display: flex; align-items: center; gap: 14px;"><div class="h1">Portugal · Review picks</div>${statusChip('accent', '182 of 1,240 picked')}</div>
      <div style="display: flex; gap: 10px;"><div class="btn">${icon('swap', 16)}Re-run selection</div><div class="btn primary">Lay out pages ${icon('chevR', 16, '#fff')}</div></div>
    </div>
    <div style="flex: 1; display: grid; grid-template-columns: 236px minmax(0, 1fr) 340px; min-height: 0;">
      <div style="border-right: 1px solid ${A.border}; padding: 20px 16px; display: flex; flex-direction: column; gap: 22px; background: ${A.side};">
        <div style="display: flex; flex-direction: column; gap: 4px;">
          ${[['Picked', '182', true], ['Alternates', '96', false], ['Rejected', '962', false]].map(([n, c, on]) => `<div class="nav${on ? ' on' : ''}" style="justify-content: space-between;"><span>${n}</span><span class="mono" style="font-size: 12px; color: ${on ? A.text : A.faint};">${c}</span></div>`).join('')}
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div class="label">Scoring preset</div>
          <div class="field" style="justify-content: space-between;"><span>Balanced</span>${icon('chevR', 14, A.muted, 'transform: rotate(90deg);')}</div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 14px;">
          ${weight('Sharpness', 70)}${weight('People', 60)}${weight('Aesthetic', 45)}${weight('Variety', 80)}
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div class="label">Rules</div>
          ${[['Collapse near-duplicates', true], ['Skip blurry', true], ['Spread across days', true], ['Every person appears', true]].map(([n, on]) => `<label style="display: flex; align-items: center; gap: 10px; min-height: 32px; font-size: 13px;"><span style="width: 32px; height: 18px; border-radius: 9px; background: ${on ? A.accentDeep : A.surface2}; position: relative;"><span style="position: absolute; top: 2px; ${on ? 'right: 2px;' : 'left: 2px;'} width: 14px; height: 14px; border-radius: 50%; background: #fff;"></span></span>${n}</label>`).join('')}
        </div>
      </div>
      <div style="padding: 20px 24px; display: flex; flex-direction: column; gap: 18px; overflow: hidden;">
        <div style="display: flex; align-items: baseline; gap: 12px;"><div style="font-weight: 600; font-size: 15px;">Tue, May 12</div><div class="muted">Lisbon · 28 picked of 214</div></div>
        <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;">
          ${thumb('tile', 'city', '8.6', { people: 'Kevin · Sam' })}${thumb('street', 'none', '8.1', { dup: '×4', selected: true })}${thumb('sea', 'sea', '7.9', { fav: true })}${thumb('stone', 'person', '7.4', { people: 'Sam' })}
          ${thumb('dusk', 'hills', '7.2')}${thumb('gold', 'pet', '7.0', { people: 'Mabel' })}${thumb('tile', 'none', '6.8', { dup: '×2' })}${thumb('street', 'city', '6.5')}
        </div>
        <div style="display: flex; align-items: baseline; gap: 12px; margin-top: 6px;"><div style="font-weight: 600; font-size: 15px;">Wed, May 13</div><div class="muted">Lisbon · 19 picked of 168</div></div>
        <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;">
          ${thumb('portrait', 'person', '8.3', { people: 'Kevin' })}${thumb('sea', 'none', '7.7')}${thumb('night', 'city', '7.5')}${thumb('moss', 'hills', '6.9', { dup: '×3' })}
        </div>
      </div>
      <div style="border-left: 1px solid ${A.border}; padding: 20px; display: flex; flex-direction: column; gap: 16px; background: ${A.side};">
        ${photo('street', 'aspect-ratio: 3 / 2; border-radius: 10px;', 'none')}
        <div style="display: flex; justify-content: space-between; align-items: center;"><div><div style="font-weight: 600;">IMG_4471.HEIC</div><div class="muted" style="font-size: 12.5px;">May 12, 14:02 · Alfama, Lisbon</div></div><span class="chip mono" style="height: 28px; background: rgba(76,195,138,0.14); color: ${A.ok};">8.1</span></div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${scoreRow('Sharpness', '0.91', 91)}${scoreRow('Exposure', '0.78', 78)}${scoreRow('Aesthetic', '7.9', 79)}${scoreRow('Faces', '0.84', 84)}
        </div>
        <div class="card" style="padding: 12px 14px; display: flex; gap: 10px; align-items: flex-start; background: ${A.surface2}; font-size: 12.5px; line-height: 1.5;">
          ${icon('sparkle', 16, A.accent, 'margin-top: 2px;')}
          <div><span style="font-weight: 600;">Why this one:</span> best of 4 taken within 40 s; sharpest, Kevin and Sam both facing camera. Others kept as alternates.</div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <div class="label">Alternates in this burst</div>
          <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px;">
            ${photo('street', 'aspect-ratio: 1; border-radius: 6px; opacity: 0.8;', 'none')}${photo('street', 'aspect-ratio: 1; border-radius: 6px; opacity: 0.7;', 'city')}${photo('stone', 'aspect-ratio: 1; border-radius: 6px; opacity: 0.6;', 'none')}
          </div>
        </div>
        <div style="flex: 1;"></div>
        <div style="display: flex; gap: 10px;"><div class="btn" style="flex: 1; justify-content: center;">${icon('x', 16)}Exclude</div><div class="btn" style="flex: 1; justify-content: center;">${icon('swap', 16)}Swap</div></div>
      </div>
    </div>
  </div>
</div>`);

// --- Page editor
const pageThumb = (n, body, on = false) => `<div style="display: flex; flex-direction: column; gap: 5px; align-items: center;"><div style="width: 88px; height: 44px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px; background: #fff; padding: 3px; border-radius: 3px; ${on ? `outline: 2px solid ${A.accent}; outline-offset: 2px;` : ''}">${body}</div><span class="mono" style="font-size: 10.5px; color: ${on ? A.text : A.faint};">${n}</span></div>`;
const tinyPage = (cells) => `<div style="display: grid; gap: 2px; ${cells}"></div>`;
const templateThumb = (on, inner) => `<div style="aspect-ratio: 1; background: #fff; border-radius: 6px; padding: 6px; display: grid; gap: 3px; ${inner} ${on ? `outline: 2px solid ${A.accent}; outline-offset: 2px;` : `border: 1px solid ${A.border};`}"></div>`;
const cell = (n = 1) => Array.from({ length: n }, () => `<div style="background: #cfd3da; border-radius: 1px;"></div>`).join('');

const Editor = wrap(APP_FONTS, APP_CSS, `<div class="app" style="flex-direction: column;">
  <div class="top" style="padding: 0 20px;">
    <div style="display: flex; align-items: center; gap: 16px;">
      <div style="display: flex; align-items: center; gap: 8px; color: ${A.muted};">${icon('chevL', 18)}<span>Books</span></div>
      <div style="width: 1px; height: 24px; background: ${A.border};"></div>
      <div class="h1" style="font-size: 17px;">Portugal</div>
      <span class="muted">Spread 7 of 24 · pages 12–13 · Lisbon</span>
    </div>
    <div style="display: flex; align-items: center; gap: 10px;">
      <div class="btn ghost" style="padding: 0 12px;">${icon('undo', 18)}</div><div class="btn ghost" style="padding: 0 12px;">${icon('redo', 18)}</div>
      <div style="width: 1px; height: 24px; background: ${A.border};"></div>
      <div class="btn">${icon('eye', 16)}Preview</div>
      <div class="btn">${icon('link', 16)}Share</div>
      <div class="btn primary">${icon('print', 16, '#fff')}Print &amp; order</div>
    </div>
  </div>
  <div style="flex: 1; display: grid; grid-template-columns: 128px minmax(0, 1fr) 320px; min-height: 0;">
    <div style="border-right: 1px solid ${A.border}; background: ${A.side}; padding: 16px 0; display: flex; flex-direction: column; gap: 14px; align-items: center; overflow: hidden;">
      ${pageThumb('cover', `<div style="grid-column: span 2; background: #6f95b8; border-radius: 2px;"></div>`)}
      ${pageThumb('1', `<div></div><div style="background: #eee;"></div>`)}
      ${pageThumb('2–3', `<div style="background: #5f8a5a;"></div><div style="background: #f4eee3;"></div>`)}
      ${pageThumb('4–5', `${tinyPage('grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;') }<div style="background: #c98a54;"></div>`)}
      ${pageThumb('6–7', `<div style="background: #4f7f97;"></div><div style="background: #a89c8c;"></div>`)}
      ${pageThumb('8–9', `<div style="background: #c46b7c; grid-column: span 2;"></div>`)}
      ${pageThumb('10–11', `<div style="background: #8ea56c;"></div><div style="display: grid; gap: 2px; grid-template-rows: 1fr 1fr;"><div style="background: #d9a45b;"></div><div style="background: #6f95b8;"></div></div>`)}
      ${pageThumb('12–13', `<div style="background: #c98a54;"></div><div style="display: grid; gap: 2px; grid-template-rows: 2fr 1fr;"><div style="background: #4f7f97;"></div><div style="display: grid; gap: 2px; grid-template-columns: 1fr 1fr;"><div style="background: #a89c8c;"></div><div style="background: #5f8a5a;"></div></div></div>`, true)}
      ${pageThumb('14–15', `<div style="background: #3d4178;"></div><div style="background: #eee;"></div>`)}
      <div class="muted" style="font-size: 11px;">···</div>
    </div>
    <div style="background: #0b0d11; display: flex; align-items: center; justify-content: center; position: relative;">
      <div style="position: absolute; left: 24px; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; border-radius: 50%; background: ${A.surface}; border: 1px solid ${A.border}; display: flex; align-items: center; justify-content: center;">${icon('chevL', 18)}</div>
      <div style="position: absolute; right: 24px; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; border-radius: 50%; background: ${A.surface}; border: 1px solid ${A.border}; display: flex; align-items: center; justify-content: center;">${icon('chevR', 18)}</div>
      <div style="display: flex; box-shadow: 0 30px 80px rgba(0,0,0,0.6);">
        <div style="width: 372px; height: 372px; background: #fbfbfa; position: relative; padding: 24px;">
          ${photo('street', 'position: absolute; inset: 0;', 'city')}
          <div style="position: absolute; left: 20px; bottom: 16px; color: rgba(255,255,255,0.9); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;">Alfama, late afternoon</div>
        </div>
        <div style="width: 372px; height: 372px; background: #fbfbfa; position: relative; box-shadow: inset 6px 0 12px -8px rgba(0,0,0,0.35); display: grid; grid-template-rows: 2fr 1fr; gap: 10px; padding: 24px 24px 24px 28px;">
          <div style="position: relative; outline: 2px solid ${A.accent}; outline-offset: 3px;">${photo('sea', 'position: absolute; inset: 0;', 'sea')}
            <span class="chip" style="position: absolute; right: -4px; top: -4px; height: 22px; background: ${A.warn}; color: #1a1400; font-size: 11px;">${icon('warn', 12, '#1a1400')}187 ppi</span>
            <span style="position: absolute; left: 50%; top: 42%; width: 14px; height: 14px; border: 2px solid #fff; border-radius: 50%; transform: translate(-50%, -50%); box-shadow: 0 0 0 1px rgba(0,0,0,0.4);"></span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">${photo('stone', '', 'person')}${photo('forest', '', 'hills')}</div>
        </div>
      </div>
      <div style="position: absolute; bottom: 18px; display: flex; gap: 8px; align-items: center; color: ${A.muted}; font-size: 12px;"><span class="mono">12</span><span style="width: 120px; height: 1px; background: ${A.border};"></span><span class="mono">13</span></div>
    </div>
    <div style="border-left: 1px solid ${A.border}; background: ${A.side}; padding: 20px; display: flex; flex-direction: column; gap: 20px; overflow: hidden;">
      <div style="display: flex; flex-direction: column; gap: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline;"><div class="label">Page 13 template</div><span class="muted" style="font-size: 12px;">3 photos</span></div>
        <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px;">
          ${templateThumb(false, 'grid-template-columns: 1fr;')}
          ${templateThumb(false, 'grid-template-columns: 1fr 1fr;')}
          ${templateThumb(true, 'grid-template-rows: 2fr 1fr; grid-template-columns: 1fr 1fr;')}
          ${templateThumb(false, 'grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;')}
          ${templateThumb(false, 'grid-template-columns: 2fr 1fr;')}
          ${templateThumb(false, 'grid-template-columns: repeat(3, 1fr); grid-template-rows: 1fr 1fr;')}
          ${templateThumb(false, 'grid-template-rows: 1fr 3fr;')}
          ${templateThumb(false, 'grid-template-columns: 1fr; padding: 22px;')}
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px;">
        <div class="label">Selected photo</div>
        <div style="display: flex; gap: 12px; align-items: center;">
          ${photo('sea', 'width: 72px; height: 48px; border-radius: 6px; flex: none;', 'sea')}
          <div style="font-size: 12.5px; line-height: 1.5;"><div style="font-weight: 600;">IMG_4502.HEIC</div><div class="muted">May 12, 18:40 · Cais do Sodré</div></div>
        </div>
        <div class="card" style="padding: 10px 12px; display: flex; gap: 10px; align-items: flex-start; background: rgba(242,179,80,0.1); border-color: rgba(242,179,80,0.4); font-size: 12.5px; line-height: 1.45;">${icon('warn', 16, A.warn, 'margin-top: 1px;')}<div>Prints at 187 ppi in this slot. Use a smaller slot or accept slight softness.</div></div>
        <div style="display: flex; gap: 8px;"><div class="btn" style="flex: 1; justify-content: center; height: 40px;">${icon('swap', 16)}Swap</div><div class="btn" style="flex: 1; justify-content: center; height: 40px;">Crop</div><div class="btn ghost" style="height: 40px; padding: 0 12px;">${icon('x', 16)}</div></div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px;">
        <div class="label">Caption</div>
        <div class="field" style="height: auto; min-height: 44px; padding: 12px 14px; align-items: flex-start; line-height: 1.45;">Alfama, late afternoon</div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <span class="chip" style="height: 30px; background: ${A.surface2}; color: ${A.muted};">Place · date</span><span class="chip" style="height: 30px; background: ${A.surface2}; color: ${A.muted};">Immich description</span><span class="chip" style="height: 30px; background: ${A.surface2}; color: ${A.muted};">${icon('sparkle', 12)}Suggest</span>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px;">
        <div class="label">Chapter</div>
        <div class="field" style="justify-content: space-between;"><span>Lisbon · May 12–16</span>${icon('chevR', 14, A.muted, 'transform: rotate(90deg);')}</div>
      </div>
    </div>
  </div>
</div>`);

// --- Public viewer (desktop)
const Viewer = wrap(APP_FONTS, APP_CSS, `<div class="app" style="flex-direction: column; background: #0a0b0e;">
  <div style="height: 72px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px;">
    <div><div style="font-weight: 600; font-size: 17px;">Portugal</div><div class="muted" style="font-size: 12.5px;">May 2026 · 48 pages · shared by Kevin</div></div>
    <div style="display: flex; gap: 10px;"><div class="btn">${icon('map', 16)}Map</div><div class="btn">${icon('grid', 16)}All pages</div><div class="btn">${icon('download', 16)}Download PDF</div></div>
  </div>
  <div style="flex: 1; position: relative; display: flex; align-items: center; justify-content: center;">
    <div style="position: absolute; left: 32px; width: 48px; height: 48px; border-radius: 50%; background: ${A.surface}; border: 1px solid ${A.border}; display: flex; align-items: center; justify-content: center;">${icon('chevL', 20)}</div>
    <div style="position: absolute; right: 32px; width: 48px; height: 48px; border-radius: 50%; background: ${A.surface}; border: 1px solid ${A.border}; display: flex; align-items: center; justify-content: center;">${icon('chevR', 20)}</div>
    <div style="display: flex; box-shadow: 0 40px 100px rgba(0,0,0,0.7), 0 2px 0 rgba(255,255,255,0.05);">
      <div style="width: 600px; height: 600px; background: #f6f1e8; position: relative;">${photo('sea', 'position: absolute; inset: 0;', 'sea')}</div>
      <div style="width: 600px; height: 600px; background: #f6f1e8; position: relative; box-shadow: inset 10px 0 18px -12px rgba(0,0,0,0.45); padding: 72px 64px; display: flex; flex-direction: column; justify-content: flex-end; gap: 16px;">
        <div style="font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-size: 76px; line-height: 1; color: #2a2622; letter-spacing: -0.02em;">Porto</div>
        <div style="width: 48px; height: 2px; background: #b5563a;"></div>
        <div style="font-family: Georgia, serif; font-size: 15px; color: #6b625a; letter-spacing: 0.02em;">May 16 – 19 · three days along the Douro</div>
      </div>
    </div>
  </div>
  <div style="height: 84px; display: flex; align-items: center; justify-content: center; gap: 24px; padding: 0 32px;">
    <div style="display: flex; gap: 4px; background: ${A.surface}; border: 1px solid ${A.border}; border-radius: 999px; padding: 4px;">
      ${['Lisbon', 'Sintra', 'Porto', 'Douro'].map((c, i) => `<span style="height: 40px; padding: 0 18px; border-radius: 999px; display: inline-flex; align-items: center; font-weight: 600; font-size: 13px; ${i === 2 ? `background: ${A.surface2}; color: ${A.text};` : `color: ${A.muted};`}">${c}</span>`).join('')}
    </div>
    <span class="muted mono" style="font-size: 12px;">Spread 13 / 24</span>
  </div>
</div>`);

// --- Public viewer (mobile 390x844)
const ViewerMobile = wrap(APP_FONTS, APP_CSS, `<div style="width: 390px; height: 844px; background: #0a0b0e; color: ${A.text}; font-family: 'Instrument Sans', system-ui, sans-serif; display: flex; flex-direction: column; padding-top: 54px;">
  <div style="padding: 0 20px 16px; display: flex; justify-content: space-between; align-items: center;">
    <div><div style="font-weight: 600; font-size: 17px;">Portugal</div><div style="color: ${A.muted}; font-size: 12.5px;">May 2026 · 48 pages</div></div>
    <div style="width: 44px; height: 44px; border-radius: 50%; background: ${A.surface}; border: 1px solid ${A.border}; display: flex; align-items: center; justify-content: center;">${icon('download', 18)}</div>
  </div>
  <div style="flex: 1; display: flex; align-items: center; justify-content: center; padding: 0 22px;">
    <div style="width: 346px; height: 346px; background: #f6f1e8; box-shadow: 0 24px 60px rgba(0,0,0,0.6); position: relative; padding: 40px 36px; display: flex; flex-direction: column; justify-content: flex-end; gap: 10px;">
      <div style="font-family: Georgia, serif; font-style: italic; font-size: 46px; line-height: 1; color: #2a2622;">Porto</div>
      <div style="width: 32px; height: 2px; background: #b5563a;"></div>
      <div style="font-family: Georgia, serif; font-size: 12px; color: #6b625a;">May 16 – 19</div>
    </div>
  </div>
  <div style="display: flex; flex-direction: column; gap: 18px; padding: 0 20px 36px; align-items: center;">
    <div style="display: flex; gap: 8px; overflow: hidden; width: 100%;">
      ${['Lisbon', 'Sintra', 'Porto', 'Douro'].map((c, i) => `<span style="height: 44px; padding: 0 16px; border-radius: 999px; display: inline-flex; align-items: center; font-weight: 600; font-size: 13px; flex: none; ${i === 2 ? `background: ${A.surface2}; color: ${A.text};` : `color: ${A.muted}; border: 1px solid ${A.border};`}">${c}</span>`).join('')}
    </div>
    <div style="display: flex; gap: 6px; align-items: center;">${Array.from({ length: 12 }, (_, i) => `<span style="width: ${i === 6 ? '18px' : '6px'}; height: 6px; border-radius: 3px; background: ${i === 6 ? A.text : A.faint};"></span>`).join('')}</div>
    <div style="color: ${A.muted}; font-size: 12px;">Swipe to turn · page 25</div>
  </div>
</div>`);

// --- Print & order
const checkRow = (ok, text) => `<div style="display: flex; gap: 10px; align-items: flex-start; font-size: 13px; line-height: 1.45;"><span style="width: 18px; height: 18px; border-radius: 50%; flex: none; margin-top: 1px; display: inline-flex; align-items: center; justify-content: center; background: ${ok ? 'rgba(76,195,138,0.18)' : 'rgba(242,179,80,0.18)'};">${icon(ok ? 'check' : 'warn', 11, ok ? A.ok : A.warn)}</span><span>${text}</span></div>`;
const radio = (on, title, sub) => `<div class="card" style="display: flex; gap: 12px; align-items: center; padding: 12px 14px; min-height: 44px; ${on ? `border-color: ${A.accent};` : ''}"><span style="width: 18px; height: 18px; border-radius: 50%; border: 2px solid ${on ? A.accent : A.border}; display: inline-flex; align-items: center; justify-content: center;">${on ? `<span style="width: 8px; height: 8px; border-radius: 50%; background: ${A.accent};"></span>` : ''}</span><div style="flex: 1;"><div style="font-weight: 600;">${title}</div><div class="muted" style="font-size: 12px;">${sub}</div></div></div>`;
const step = (state, name, sub) => {
  const c = state === 'done' ? A.ok : state === 'now' ? A.accent : A.faint;
  return `<div style="display: flex; gap: 12px; align-items: flex-start;"><span style="width: 10px; height: 10px; border-radius: 50%; background: ${c}; margin-top: 5px; flex: none; ${state === 'now' ? `box-shadow: 0 0 0 4px rgba(124,140,255,0.25);` : ''}"></span><div><div style="font-weight: 600; font-size: 13px; color: ${state === 'todo' ? A.muted : A.text};">${name}</div><div class="muted" style="font-size: 12px;">${sub}</div></div></div>`;
};

const Order = wrap(APP_FONTS, APP_CSS, `<div class="app">
  ${sidebar('orders')}
  <div class="main">
    <div class="top"><div style="display: flex; align-items: center; gap: 14px;"><div class="h1">Portugal · Print &amp; order</div>${statusChip('warn', 'Lulu sandbox')}</div><div class="muted">Payment happens on lulu.com after the job is created</div></div>
    <div style="padding: 24px 28px; display: grid; grid-template-columns: 340px minmax(0, 1fr) 360px; gap: 24px; overflow: hidden;">
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div class="label">Product</div>
          ${radio(true, 'Hardcover · case wrap', '8.5 × 8.5 in · premium color · 80# coated · matte')}
          ${radio(false, 'Hardcover · linen wrap', 'Dust jacket, optional foil title')}
          ${radio(false, 'Softcover · perfect bound', 'Same paper, lighter, from 20 pages')}
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div class="label">Preflight</div>
          <div class="card" style="padding: 14px 16px; display: flex; flex-direction: column; gap: 10px;">
            ${checkRow(true, '48 pages, even count, within 24–800 for case wrap')}
            ${checkRow(true, 'Interior 8.75 × 8.75 in with 0.125 in bleed, no marks')}
            ${checkRow(true, 'Cover spread 18.28 × 8.75 in, spine 0.28 in (from Lulu)')}
            ${checkRow(true, 'Fonts embedded · sRGB · nothing inside 0.5 in safety')}
            ${checkRow(false, '1 photo below 200 ppi (page 13) · open in editor')}
          </div>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div class="label">Cover spread</div>
          <div class="card" style="padding: 18px; display: flex; justify-content: center; background: #0b0d11;">
            <div style="display: flex; width: 100%; aspect-ratio: 18.28 / 8.75; position: relative;">
              <div style="flex: 1; background: #f6f1e8; position: relative; padding: 18px; display: flex; align-items: flex-end;"><div style="font-family: Georgia, serif; font-size: 9px; color: #6b625a;">Lisbon · Sintra · Porto · Douro — 182 photographs</div></div>
              <div style="width: 3%; background: #2a2622; display: flex; align-items: center; justify-content: center;"><div style="writing-mode: vertical-rl; transform: rotate(180deg); font-family: Georgia, serif; font-style: italic; font-size: 10px; color: #f6f1e8;">Portugal · 2026</div></div>
              <div style="flex: 1; position: relative;">${photo('sea', 'position: absolute; inset: 0;', 'sea')}<div style="position: absolute; left: 20px; bottom: 16px; font-family: Georgia, serif; font-style: italic; font-size: 34px; color: #fff8ec;">Portugal</div></div>
              <div style="position: absolute; inset: 0; border: 1px dashed rgba(239,107,116,0.7); pointer-events: none;"></div>
            </div>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div class="label">Files</div>
          <div class="card" style="display: flex; flex-direction: column;">
            ${[['interior.pdf', '48 pages · 8.75 × 8.75 in · 142 MB · rendered 4 min ago', 'Validated by Lulu'], ['cover.pdf', '1 spread · 18.28 × 8.75 in · 18 MB', 'Validated by Lulu']].map(([n, m, s], i) => `<div style="display: flex; align-items: center; gap: 14px; padding: 14px 16px; ${i ? `border-top: 1px solid ${A.border};` : ''}">${icon('print', 20, A.muted)}<div style="flex: 1;"><div style="font-weight: 600;" class="mono">${n}</div><div class="muted" style="font-size: 12.5px;">${m}</div></div>${statusChip('ok', s)}<div class="btn" style="height: 40px;">${icon('download', 16)}Export</div></div>`).join('')}
            <div style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid ${A.border}; font-size: 12.5px;">${icon('link', 16, A.ok)}<span>Public links reachable from outside via</span><span class="mono" style="color: ${A.text};">books.example.com/public/exports/…</span><span class="muted">· expires in 6 days</span></div>
          </div>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div class="card" style="padding: 20px; display: flex; flex-direction: column; gap: 14px;">
          <div class="label">Quote</div>
          <div style="display: flex; justify-content: space-between;"><span>1 × hardcover, 48 pages</span><span class="mono">$21.29</span></div>
          <div style="display: flex; justify-content: space-between;"><span>Shipping · Ground</span><span class="mono">$6.99</span></div>
          <div style="display: flex; justify-content: space-between;"><span class="muted">Tax</span><span class="mono muted">$1.98</span></div>
          <div style="height: 1px; background: ${A.border};"></div>
          <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 16px;"><span>Total</span><span class="mono">$30.26</span></div>
          <div class="field" style="justify-content: space-between;"><span>Quantity 1</span><span class="muted">+ gift copies</span></div>
          <div class="field" style="justify-content: space-between;"><span>Ground · 5–8 days</span>${icon('chevR', 14, A.muted, 'transform: rotate(90deg);')}</div>
          <div class="card" style="padding: 12px 14px; font-size: 13px; line-height: 1.5; background: ${A.surface2};"><div style="font-weight: 600;">Kevin Boutwell</div><div class="muted">[STREET ADDRESS]<br>Raleigh, NC [ZIP] · United States</div></div>
          <div class="btn primary" style="justify-content: center;">Create print job</div>
        </div>
        <div class="card" style="padding: 20px; display: flex; flex-direction: column; gap: 14px;">
          <div class="label">Order status</div>
          ${step('done', 'Files validated', 'Interior and cover normalized by Lulu')}
          ${step('now', 'Create print job', 'Then pay on lulu.com')}
          ${step('todo', 'Production', 'Usually 3–5 business days')}
          ${step('todo', 'Shipped', 'Tracking link appears here')}
        </div>
      </div>
    </div>
  </div>
</div>`);

const appBoards = { Main: Dashboard, NewBook, TripPicker, Review, Editor, Viewer, ViewerMobile, Order };
for (const [name, html] of Object.entries(appBoards)) writeFileSync(join(APP_DIR, `${name}.dc.html`), html);
const appCanvas = {
  artboards: [
    { file: 'Main.dc.html', title: 'Dashboard', x: 0, y: 0, w: 1440, h: 900 },
    { file: 'NewBook.dc.html', title: 'New book · Source', x: 1560, y: 0, w: 1440, h: 900 },
    { file: 'TripPicker.dc.html', title: 'New book · Trip clusters', x: 3120, y: 0, w: 1440, h: 900 },
    { file: 'Review.dc.html', title: 'Review picks', x: 4680, y: 0, w: 1440, h: 900 },
    { file: 'Editor.dc.html', title: 'Page editor', x: 0, y: 1060, w: 1440, h: 900 },
    { file: 'Viewer.dc.html', title: 'Shared viewer', x: 1560, y: 1060, w: 1440, h: 900 },
    { file: 'ViewerMobile.dc.html', title: 'Shared viewer · phone', x: 3120, y: 1060, w: 390, h: 844 },
    { file: 'Order.dc.html', title: 'Print & order', x: 3630, y: 1060, w: 1440, h: 900 },
  ],
  annotations: [
    { id: 'flow', x: 0, y: -200, w: 620, text: 'Flow, left to right: Dashboard → New book (source) → Trip clusters → Review picks → Page editor → Shared viewer / Print & order.\nDark, utilitarian chrome so it sits comfortably next to Immich. Photos are gradient stand-ins.' },
    { id: 'q-dashboard', x: 700, y: -140, w: 300, text: 'Question: should suggested trips live on the dashboard like this, or only inside New book?' },
    { id: 'q-review', x: 4680, y: -140, w: 360, text: 'Review picks: every auto decision is explained and reversible. Weights on the left re-run scoring live. Is the grid dense enough, or do you want bigger thumbnails?' },
    { id: 'q-editor', x: 0, y: 2000, w: 360, text: 'Editor, phase A: swap / crop / caption / template per page. Phase B adds free drag of slots on the same spread view.' },
  ],
  launch: { view: 'canvas' },
};
writeFileSync(join(APP_DIR, 'canvas.json'), JSON.stringify(appCanvas, null, 2));

// ================================================================ CANVAS B: BOOK TEMPLATES
// 96 px per inch. 8.5 in trim = 816 px. Bleed 0.125 in = 12 px. Safety 0.5 in = 48 px. Gutter safety 0.375 in = 36 px.
const IN = 96, TRIM = 816, BLEED = 12, SAFE = 48, GUT = 36;
const G = { paper: '#fbfbfa', ink: '#2b2b2b', cap: '#6f6f6f', rule: '#d8d8d4', font: "'Manrope', 'Helvetica Neue', Arial, sans-serif" };
const E = { paper: '#f6f1e8', ink: '#2a2622', cap: '#6b625a', accent: '#b5563a', display: "'Newsreader', Georgia, 'Times New Roman', serif", body: "'Source Serif 4', Georgia, serif" };
const BOOK_FONTS = 'family=Manrope:wght@300;400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,300;1,6..72,400&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&family=JetBrains+Mono:wght@400';
const BOOK_CSS = `
    a { color: ${E.accent}; } a:hover { color: #8e3f2a; }
    .board { position: relative; overflow: hidden; }
    .guide { position: absolute; pointer-events: none; }
    .tag { position: absolute; left: 8px; top: 8px; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #fff; background: rgba(20,20,20,0.55); padding: 3px 6px; border-radius: 3px; letter-spacing: 0.02em; }
`;

// guides overlay for a board of pages; pagesX = array of trim-left x positions; all pages same height
const guidesFor = (pageXs, W, H, showSpine) => {
  let g = `<div class="guide" style="inset: 0; border: ${BLEED}px solid rgba(220,60,60,0.10);"></div>`;
  for (const x of pageXs) {
    g += `<div class="guide" style="left: ${x}px; top: ${BLEED}px; width: ${TRIM}px; height: ${H - 2 * BLEED}px; outline: 1px solid rgba(220,60,60,0.55); outline-offset: -1px;"></div>`;
    g += `<div class="guide" style="left: ${x + SAFE}px; top: ${BLEED + SAFE}px; width: ${TRIM - 2 * SAFE}px; height: ${H - 2 * BLEED - 2 * SAFE}px; border: 1px dashed rgba(60,120,220,0.5);"></div>`;
  }
  if (showSpine !== undefined) {
    g += `<div class="guide" style="left: ${showSpine - 1}px; top: 0; width: 2px; height: ${H}px; background: rgba(60,60,60,0.35);"></div>`;
    g += `<div class="guide" style="left: ${showSpine - GUT}px; top: ${BLEED}px; width: ${2 * GUT}px; height: ${H - 2 * BLEED}px; background: repeating-linear-gradient(135deg, rgba(60,120,220,0.06) 0 6px, transparent 6px 12px);"></div>`;
  }
  return g;
};
// a single page board: content positioned in page coords (origin = trim top-left)
const pageBoard = (paper, inner, opts = {}) => {
  const W = TRIM + 2 * BLEED, H = (opts.trimH ?? TRIM) + 2 * BLEED;
  return `<div class="board" style="width: ${W}px; height: ${H}px; background: ${paper}; font-family: ${opts.font ?? G.font}; color: ${opts.ink ?? G.ink};">
  <div style="position: absolute; left: ${BLEED}px; top: ${BLEED}px; width: ${TRIM}px; height: ${H - 2 * BLEED}px;">${inner}</div>
  ${guidesFor([BLEED], W, H)}
</div>`;
};
// spread board: left page trim at x=BLEED, right page trim at x=BLEED+TRIM (+spine)
const spreadBoard = (paper, left, right, opts = {}) => {
  const spine = opts.spine ?? 0;
  const W = 2 * TRIM + 2 * BLEED + spine, H = TRIM + 2 * BLEED;
  const rx = BLEED + TRIM + spine;
  return `<div class="board" style="width: ${W}px; height: ${H}px; background: ${paper}; font-family: ${opts.font ?? G.font}; color: ${opts.ink ?? G.ink};">
  <div style="position: absolute; left: ${BLEED}px; top: ${BLEED}px; width: ${TRIM}px; height: ${TRIM}px;">${left}</div>
  ${spine ? `<div style="position: absolute; left: ${BLEED + TRIM}px; top: 0; width: ${spine}px; height: ${H}px;">${opts.spineHtml ?? ''}</div>` : ''}
  <div style="position: absolute; left: ${rx}px; top: ${BLEED}px; width: ${TRIM}px; height: ${TRIM}px;">${right}</div>
  ${guidesFor([BLEED, rx], W, H, spine ? undefined : BLEED + TRIM)}
  ${spine ? `<div class="guide" style="left: ${BLEED + TRIM}px; top: 0; width: ${spine}px; height: ${H}px; outline: 1px dashed rgba(60,60,60,0.45); outline-offset: -1px;"></div>` : ''}
</div>`;
};
// slot in page coords; negative / oversize extents are allowed for bleed
const slot = (x, y, w, h, tone, scene = 'none', tag = '') =>
  photo(tone, `position: absolute; left: ${x}px; top: ${y}px; width: ${w}px; height: ${h}px;`, scene).replace('</div>', `${tag ? `<span class="tag">${tag}</span>` : ''}</div>`);
const FULL = [-BLEED, -BLEED, TRIM + 2 * BLEED, TRIM + 2 * BLEED];
const capG = (x, y, text, extra = '') => `<div style="position: absolute; left: ${x}px; top: ${y}px; font-family: ${G.font}; font-weight: 300; font-size: 13px; letter-spacing: 0.02em; color: ${G.cap}; ${extra}">${text}</div>`;
const smallcapsG = (x, y, text, extra = '') => `<div style="position: absolute; left: ${x}px; top: ${y}px; font-family: ${G.font}; font-weight: 500; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: ${G.ink}; ${extra}">${text}</div>`;
const folio = (x, y, n, color) => `<div style="position: absolute; left: ${x}px; top: ${y}px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: ${color};">${n}</div>`;

const B = {};
const bookWrap = (body) => wrap(BOOK_FONTS, BOOK_CSS, body);

// --- Main: anatomy + tokens (1440x900 dark spec sheet)
B.Main = wrap(BOOK_FONTS + '&family=Instrument+Sans:wght@400;500;600', BOOK_CSS + `
    .spec { box-sizing: border-box; width: 1440px; height: 900px; overflow: hidden; background: #14161b; color: #e8eaf0; font-family: 'Instrument Sans', system-ui, sans-serif; display: grid; grid-template-columns: 560px minmax(0, 1fr); gap: 48px; padding: 48px; }
    .k { color: #8d95a7; font-size: 12.5px; } .v { font-size: 13.5px; }
    .row { display: grid; grid-template-columns: 130px 1fr; gap: 12px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid #262a33; }
`, `<div class="spec">
  <div style="display: flex; flex-direction: column; gap: 20px;">
    <div><div style="font-size: 22px; font-weight: 600; letter-spacing: -0.01em;">Page anatomy · 8.5 × 8.5 in</div><div class="k" style="margin-top: 6px;">Every template board below is drawn at 96 px per inch with these guides. Lulu casewrap rules.</div></div>
    <div style="position: relative; width: 464px; height: 464px; background: #fbfbfa; margin-left: 40px;">
      <div style="position: absolute; inset: 0; border: 6px solid rgba(220,60,60,0.14);"></div>
      <div style="position: absolute; inset: 6px; outline: 1px solid rgba(220,60,60,0.75); outline-offset: -1px;"></div>
      <div style="position: absolute; inset: 30px; border: 1px dashed rgba(60,120,220,0.7);"></div>
      <div style="position: absolute; left: 0; top: 0; width: 24px; height: 100%; background: repeating-linear-gradient(135deg, rgba(60,120,220,0.10) 0 6px, transparent 6px 12px);"></div>
      <div style="position: absolute; left: 30px; top: 30px; right: 30px; height: 250px; background: ${TONES.sea};"></div>
      <div style="position: absolute; left: 30px; top: 296px; font-family: ${G.font}; font-weight: 300; font-size: 8px; color: ${G.cap};">Caption sits inside the safety line</div>
      <div style="position: absolute; left: -40px; top: -2px; color: #ef6b74; font-size: 11px; width: 36px; text-align: right;">bleed</div>
      <div style="position: absolute; left: -40px; top: 26px; color: #7ea2ff; font-size: 11px; width: 36px; text-align: right;">safety</div>
      <div style="position: absolute; left: 4px; bottom: -22px; color: #8d95a7; font-size: 11px;">spine side · gutter safety 0.375 in</div>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-top: 12px;">
      <div class="row"><span class="k">Trim</span><span class="v">8.5 × 8.5 in · 816 px</span></div>
      <div class="row"><span class="k">Bleed</span><span class="v">0.125 in · 12 px each side</span></div>
      <div class="row"><span class="k">Safety</span><span class="v">0.5 in · 48 px from trim</span></div>
      <div class="row"><span class="k">Gutter safety</span><span class="v">0.375 in · 36 px from spine</span></div>
      <div class="row"><span class="k">PDF page</span><span class="v">8.75 × 8.75 in, no marks</span></div>
      <div class="row"><span class="k">Cover</span><span class="v">one spread, spine from Lulu</span></div>
    </div>
  </div>
  <div style="display: grid; grid-template-columns: 1fr; gap: 32px;">
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="height: 120px; background: ${E.paper}; border-radius: 6px; padding: 24px; display: flex; flex-direction: column; justify-content: flex-end; gap: 6px; color: ${E.ink};">
        <div style="font-family: ${E.display}; font-style: italic; font-size: 34px; line-height: 1;">Warm editorial <span style="font-size: 14px; font-style: normal; font-family: 'Instrument Sans', sans-serif; color: ${E.accent}; letter-spacing: 0.08em; text-transform: uppercase; margin-left: 12px;">chosen style</span></div>
        <div style="font-family: ${E.body}; font-size: 13px; color: ${E.cap};">Off-white paper, serif titles, magazine grids, a little terracotta.</div>
      </div>
      <div class="row"><span class="k">Paper</span><span class="v">#f6f1e8</span></div>
      <div class="row"><span class="k">Ink</span><span class="v">#2a2622 · captions #6b625a</span></div>
      <div class="row"><span class="k">Type</span><span class="v">Newsreader italic + Source Serif 4</span></div>
      <div class="row"><span class="k">Titles</span><span class="v">72–96 px italic, tight leading</span></div>
      <div class="row"><span class="k">Captions</span><span class="v">14 px serif, 10.5 pt printed</span></div>
      <div class="row"><span class="k">Margins</span><span class="v">56 px outer · 16 px between photos</span></div>
      <div class="row"><span class="k">Accent</span><span class="v">#b5563a rules and folios</span></div>
      <div class="row"><span class="k">Mood</span><span class="v">travel magazine, keepsake</span></div>
    </div>
  </div>
</div>`);

// --- Covers (spine 40 px ≈ 0.42 in for 48 pages)
const SPINE = 40;
B.CoverGallery = bookWrap(spreadBoard(G.paper,
  // back
  `${capG(SAFE, TRIM - SAFE - 40, '182 photographs · Lisbon, Sintra, Porto, Douro')}
   <div style="position: absolute; left: ${SAFE}px; top: ${TRIM - SAFE - 84}px; width: 40px; height: 40px; border: 1px solid ${G.rule}; display: grid; grid-template-columns: repeat(5, 1fr); gap: 2px; padding: 5px;">${Array.from({ length: 25 }, (_, i) => `<div style="background: ${[0, 1, 2, 4, 5, 7, 9, 10, 12, 14, 15, 17, 19, 20, 22, 24].includes(i) ? '#333' : 'transparent'};"></div>`).join('')}</div>`,
  // front
  `${slot(128, 128, 560, 480, 'tile', 'city')}
   ${smallcapsG(128, 648, 'Portugal')}
   ${capG(128, 676, 'May 2026')}`,
  { spine: SPINE, spineHtml: `<div style="position: absolute; left: 0; top: 0; width: ${SPINE}px; height: 100%; display: flex; align-items: center; justify-content: center;"><div style="writing-mode: vertical-rl; transform: rotate(180deg); font-family: ${G.font}; font-weight: 500; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: ${G.ink};">Portugal · 2026</div></div>` }));

B.CoverEditorial = bookWrap(spreadBoard(E.paper,
  `${slot(-BLEED, -BLEED, TRIM + BLEED + SPINE + TRIM + BLEED, TRIM + 2 * BLEED, 'sea', 'sea')}
   <div style="position: absolute; left: 56px; bottom: 56px; font-family: ${E.body}; font-size: 14px; color: rgba(255,248,236,0.9); line-height: 1.5; width: 380px;">Ten days in Portugal: Lisbon’s hills, an afternoon in Sintra, three days along the Douro.</div>`,
  `<div style="position: absolute; left: 56px; bottom: 120px; font-family: ${E.display}; font-style: italic; font-weight: 300; font-size: 128px; line-height: 0.95; letter-spacing: -0.02em; color: #fff8ec;">Portugal</div>
   <div style="position: absolute; left: 60px; bottom: 96px; width: 56px; height: 2px; background: #fff8ec;"></div>
   <div style="position: absolute; left: 60px; bottom: 60px; font-family: ${E.body}; font-size: 15px; letter-spacing: 0.04em; color: rgba(255,248,236,0.9);">Lisbon · Sintra · Porto · Douro — May 2026</div>`,
  { spine: SPINE, font: E.body, ink: E.ink, spineHtml: `<div style="position: absolute; left: 0; top: 0; width: ${SPINE}px; height: 100%; display: flex; align-items: center; justify-content: center;"><div style="writing-mode: vertical-rl; transform: rotate(180deg); font-family: ${E.display}; font-style: italic; font-size: 16px; color: #fff8ec;">Portugal · 2026</div></div>` }));

// --- Chapter openers
B.OpenerGallery = bookWrap(spreadBoard(G.paper,
  `${smallcapsG(SAFE, TRIM - SAFE - 92, 'Chapter III')}
   <div style="position: absolute; left: ${SAFE}px; top: ${TRIM - SAFE - 64}px; font-family: ${G.font}; font-weight: 300; font-size: 40px; letter-spacing: -0.01em; color: ${G.ink};">Porto</div>
   ${capG(SAFE, TRIM - SAFE - 12, 'May 16 – 19')}
   ${folio(SAFE, 40, '24', G.cap)}`,
  slot(-GUT + 36, -BLEED, TRIM + BLEED + GUT - 36, TRIM + 2 * BLEED, 'street', 'city')));

B.OpenerEditorial = bookWrap(spreadBoard(E.paper,
  slot(-BLEED, -BLEED, TRIM + BLEED, TRIM + 2 * BLEED, 'dusk', 'hills'),
  `<div style="position: absolute; left: 56px; top: 96px; font-family: ${E.display}; font-style: italic; font-weight: 300; font-size: 112px; line-height: 0.95; letter-spacing: -0.02em; color: ${E.ink};">Porto</div>
   <div style="position: absolute; left: 60px; top: 236px; width: 48px; height: 2px; background: ${E.accent};"></div>
   <div style="position: absolute; left: 60px; top: 262px; font-family: ${E.body}; font-size: 15px; letter-spacing: 0.02em; color: ${E.cap};">May 16 – 19 · 61 photographs</div>
   <div style="position: absolute; left: 60px; top: 320px; width: 420px; font-family: ${E.body}; font-size: 16px; line-height: 1.6; color: ${E.ink};">Three days along the Douro. The train from Lisbon, the tiled station, the bridge at dusk, and a slow morning in Ribeira before the boats went out.</div>
   <svg viewBox="0 0 320 200" style="position: absolute; left: 60px; top: 500px; width: 320px; height: 200px;">
     <path d="M0 150 C 60 120, 110 170, 170 140 S 260 90, 320 110" stroke="#d9cdb9" stroke-width="1.5" fill="none"></path>
     <path d="M0 60 C 80 40, 160 80, 320 40" stroke="#d9cdb9" stroke-width="1.5" fill="none" stroke-dasharray="4 4"></path>
     <path d="M62 128 L 140 108 L 172 76 L 250 74" stroke="${E.accent}" stroke-width="1.5" fill="none" stroke-dasharray="3 3"></path>
     <circle cx="62" cy="128" r="4" fill="${E.accent}"></circle><circle cx="140" cy="108" r="4" fill="${E.accent}"></circle><circle cx="172" cy="76" r="5" fill="${E.accent}"></circle><circle cx="250" cy="74" r="4" fill="${E.accent}"></circle>
     <text x="62" y="146" font-family="Source Serif 4, serif" font-size="11" fill="${E.cap}" text-anchor="middle">Lisbon</text>
     <text x="172" y="66" font-family="Source Serif 4, serif" font-size="11" fill="${E.cap}" text-anchor="middle">Porto</text>
     <text x="250" y="92" font-family="Source Serif 4, serif" font-size="11" fill="${E.cap}" text-anchor="middle">Pinhão</text>
   </svg>
   ${folio(TRIM - SAFE - 20, TRIM - SAFE + 18, '25', E.accent)}`,
  { font: E.body, ink: E.ink }));

// --- Interior spreads
const gap = 24;
B.SpreadGallery1 = bookWrap(spreadBoard(G.paper,
  `${slot(SAFE + 60, SAFE, TRIM - 2 * SAFE - 60, TRIM - 2 * SAFE - 48, 'portrait', 'person')}
   ${capG(SAFE + 60, TRIM - SAFE - 30, 'Sam, Miradouro da Graça')}
   ${folio(SAFE, TRIM - SAFE - 30, '12', G.cap)}`,
  `${slot(SAFE, SAFE, TRIM - 2 * SAFE, 440, 'sea', 'sea')}
   ${slot(SAFE, SAFE + 440 + gap, (TRIM - 2 * SAFE - gap) / 2, 200, 'street', 'city')}
   ${slot(SAFE + (TRIM - 2 * SAFE - gap) / 2 + gap, SAFE + 440 + gap, (TRIM - 2 * SAFE - gap) / 2, 200, 'stone', 'none')}
   ${capG(SAFE, TRIM - SAFE - 30, 'Cais do Sodré · Alfama · Rua Augusta')}
   ${folio(TRIM - SAFE - 20, TRIM - SAFE - 30, '13', G.cap)}`));

B.SpreadEditorial1 = bookWrap(spreadBoard(E.paper,
  `${slot(-BLEED, -BLEED, TRIM + BLEED - 20, 470, 'tile', 'city')}
   ${slot(56, 486, 330, 250, 'street', 'none')}
   ${slot(402, 486, 358, 250, 'portrait', 'person')}
   <div style="position: absolute; left: 56px; top: 752px; font-family: ${E.body}; font-style: italic; font-size: 14px; color: ${E.cap};">Alfama, late afternoon — the 28 tram, and Sam finding the best pastel de nata in the city.</div>`,
  `<div style="position: absolute; left: 76px; top: 72px; font-family: ${E.display}; font-style: italic; font-weight: 300; font-size: 168px; line-height: 0.9; color: ${E.accent};">12</div>
   <div style="position: absolute; left: 80px; top: 236px; font-family: ${E.body}; font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: ${E.cap};">Tuesday, May</div>
   <div style="position: absolute; left: 80px; top: 290px; width: 300px; font-family: ${E.body}; font-size: 16px; line-height: 1.65; color: ${E.ink};">We walked up from the river without a plan and let the hills decide. Every corner had another view, another tiled wall, another cat asleep on a warm step.</div>
   ${slot(420, 72, 340, 664, 'dusk', 'person')}
   <div style="position: absolute; left: 80px; top: 720px; width: 300px; font-family: ${E.body}; font-style: italic; font-size: 14px; color: ${E.cap};">Kevin, Miradouro de Santa Luzia</div>
   ${folio(TRIM - SAFE - 20, TRIM - SAFE + 18, '13', E.accent)}`,
  { font: E.body, ink: E.ink }));

B.SpreadGallery2 = bookWrap(spreadBoard(G.paper,
  `${slot(-BLEED, 120, TRIM + BLEED, 520, 'forest', 'hills')}
   ${folio(SAFE, TRIM - SAFE - 30, '18', G.cap)}`,
  `${slot(0, 120, TRIM + BLEED, 520, 'moss', 'hills')}
   ${capG(SAFE, 664, 'Douro valley from the N-222, near Pinhão')}
   ${folio(TRIM - SAFE - 20, TRIM - SAFE - 30, '19', G.cap)}`));

B.SpreadEditorial2 = bookWrap(spreadBoard(E.paper,
  `${slot(56, 56, 420, 300, 'gold', 'none')}
   ${slot(492, 56, 268, 300, 'stone', 'person')}
   ${slot(56, 372, 268, 364, 'street', 'city')}
   ${slot(340, 372, 420, 364, 'night', 'city')}
   ${folio(56, TRIM - SAFE + 18, '30', E.accent)}`,
  `${slot(0, -BLEED, TRIM + BLEED, TRIM + 2 * BLEED, 'sea', 'sea')}
   <div style="position: absolute; left: 0; right: -${BLEED}px; bottom: -${BLEED}px; padding: 28px 56px 40px; background: linear-gradient(180deg, rgba(20,20,25,0) 0%, rgba(20,20,25,0.55) 100%);">
     <div style="font-family: ${E.display}; font-style: italic; font-size: 34px; color: #fff8ec; line-height: 1.1;">Last light on the Douro</div>
     <div style="font-family: ${E.body}; font-size: 14px; color: rgba(255,248,236,0.85); margin-top: 8px;">Pinhão, May 18 · 20:41</div>
   </div>`,
  { font: E.body, ink: E.ink }));

// --- Single-page template library in the chosen style B (warm editorial), slot tags for transcription
const pageL = (inner, opts = {}) => pageBoard(E.paper, inner, { font: E.body, ink: E.ink, ...opts });
const capL = (x, y, text, extra = '') => `<div style="position: absolute; left: ${x}px; top: ${y}px; font-family: ${E.body}; font-style: italic; font-size: 14px; color: ${E.cap}; ${extra}">${text}</div>`;
const titleL = (x, y, text, extra = '') => `<div style="position: absolute; left: ${x}px; top: ${y}px; font-family: ${E.display}; font-style: italic; font-weight: 300; font-size: 44px; line-height: 1; letter-spacing: -0.02em; color: ${E.ink}; ${extra}">${text}</div>`;
const S = SAFE, C = TRIM - 2 * SAFE; // content box
B.TitlePage = bookWrap(pageBoard(G.paper,
  `${titleL(S, 340, 'Portugal', 'font-size: 14px;')}
   ${capL(S, 372, 'May 12 – 21, 2026 · 182 photographs')}
   <div style="position: absolute; left: ${S}px; top: 404px; width: 32px; height: 1px; background: ${E.ink};"></div>
   ${capL(S, TRIM - S - 18, 'Kevin Boutwell')}`));
B.OneUpFullBleed = bookWrap(pageL(`${slot(...FULL, 'sea', 'sea', '1 · full bleed · any ratio')}`));
B.OneUpMatted = bookWrap(pageL(`${slot(S, S, C, C - 48, 'portrait', 'person', '1 · matted · 3:2 or 1:1')}${capL(S, TRIM - S - 30, 'Caption, place · date')}`));
B.TwoUp = bookWrap(pageL(`${slot(S, S, C, (C - gap) / 2, 'street', 'city', '1 · 3:2 · landscape')}${slot(S, S + (C + gap) / 2, C, (C - gap) / 2, 'tile', 'none', '2 · 3:2 · landscape')}`));
B.ThreeUp = bookWrap(pageL(`${slot(S, S, C, 440, 'dusk', 'hills', '1 · hero · 16:10')}${slot(S, S + 440 + gap, (C - gap) / 2, C - 440 - gap, 'stone', 'none', '2 · 4:3')}${slot(S + (C + gap) / 2, S + 440 + gap, (C - gap) / 2, C - 440 - gap, 'moss', 'person', '3 · 4:3')}`));
B.FourUpGrid = bookWrap(pageL([0, 1, 2, 3].map((i) => slot(S + (i % 2) * (C + gap) / 2, S + Math.floor(i / 2) * (C + gap) / 2, (C - gap) / 2, (C - gap) / 2, ['tile', 'gold', 'forest', 'portrait'][i], ['city', 'none', 'hills', 'person'][i], `${i + 1} · 1:1`)).join('')));
B.HeroStrip = bookWrap(pageL(`${slot(-BLEED, -BLEED, TRIM + 2 * BLEED, 560, 'sea', 'sea', '1 · hero · full bleed top')}${[0, 1, 2].map((i) => slot(S + i * (C + gap) / 3, 560 + 28, (C - 2 * gap) / 3, 136, ['street', 'stone', 'dusk'][i], 'none', `${i + 2} · 3:2`)).join('')}${capL(S, TRIM - S - 4, 'Strip captions optional')}`));
B.Mosaic6 = bookWrap(pageL(`${slot(S, S, 460, 460, 'portrait', 'person', '1 · 1:1 · hero')}${slot(S + 460 + gap, S, C - 460 - gap, 218, 'tile', 'city', '2 · 5:4')}${slot(S + 460 + gap, S + 218 + gap, C - 460 - gap, 218, 'gold', 'pet', '3 · 5:4')}${[0, 1, 2].map((i) => slot(S + i * (C + gap) / 3, S + 460 + gap, (C - 2 * gap) / 3, C - 460 - gap, ['forest', 'sea', 'street'][i], 'none', `${i + 4} · 4:3`)).join('')}`));
B.TextPhoto = bookWrap(pageL(`${slot(S + 300, S, C - 300, C, 'dusk', 'hills', '1 · portrait · 2:3')}${titleL(S, S + 8, 'Sintra')}${capL(S, S + 40, 'Wednesday, May 14')}<div style="position: absolute; left: ${S}px; top: ${S + 88}px; width: 252px; font-family: ${E.body}; font-weight: 300; font-size: 14px; line-height: 1.7; color: ${E.ink};">A day trip that turned into a whole day: the palace in fog, then sun by the time we reached the Moorish walls. Body text from Immich descriptions or written here.</div>`));
B.ContactSheet = bookWrap(pageL(`<div style="position: absolute; left: ${S}px; top: ${S}px; width: ${C}px; height: ${C - 40}px; display: flex; flex-direction: column; gap: 10px;">
  ${[[['sea', 3], ['street', 2], ['tile', 3]], [['portrait', 2], ['gold', 3], ['stone', 3], ['dusk', 2]], [['forest', 3], ['moss', 2], ['night', 3]], [['tile', 2], ['sea', 3], ['street', 2], ['portrait', 2]]].map((row) => `<div style="display: flex; gap: 10px; flex: 1; min-height: 0;">${row.map(([t, w]) => photo(t, `flex: ${w}; min-width: 0;`)).join('')}</div>`).join('')}
</div>${capL(S, TRIM - S - 22, 'Justified rows (Immich layout) · 14 photos · row height 150–170 px')}`));
B.Colophon = bookWrap(pageL(`<div style="position: absolute; left: ${S}px; top: ${TRIM - S - 200}px; width: 120px; height: 120px; border: 1px solid #d9cdb9; display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; padding: 10px;">${Array.from({ length: 49 }, (_, i) => `<div style="background: ${(i * 7 + 3) % 5 < 3 ? '#333' : 'transparent'};"></div>`).join('')}</div>
  ${capL(S + 144, TRIM - S - 196, 'Scan to see this book on screen', `color: ${E.ink}; font-weight: 500;`)}
  ${capL(S + 144, TRIM - S - 170, 'books.example.com/s/[TOKEN]')}
  ${capL(S, TRIM - S - 44, '182 photographs from 1,240 · picked and laid out with Immich Bookbinder · printed by Lulu')}
  ${capL(S, TRIM - S - 20, 'Made in September 2026')}`));

B.LetterFourUp = bookWrap(pageL((() => {
  const H = 1056, CH = H - 2 * SAFE;
  return [0, 1, 2, 3].map((i) => slot(S + (i % 2) * (C + gap) / 2, S + Math.floor(i / 2) * (CH + gap) / 2, (C - gap) / 2, (CH - gap) / 2 - 20, ['tile', 'gold', 'forest', 'portrait'][i], ['city', 'none', 'hills', 'person'][i], `${i + 1} · 4:5`)).join('') + capL(S, H - S - 22, 'Same template on 8.5 × 11 in — slots keep proportions, margins stay 0.5 in');
})(), { trimH: 1056 }));

for (const [name, html] of Object.entries(B)) writeFileSync(join(BOOK_DIR, `${name}.dc.html`), html);
const PW = TRIM + 2 * BLEED, SW = 2 * TRIM + 2 * BLEED, CW = SW + SPINE;
const rowY = [0, 1040, 2000, 2960, 3920, 4880, 5840];
const bookCanvas = {
  pages: [{ id: 'page-1', name: 'Templates · warm editorial' }, { id: 'page-2', name: 'Unchosen · clean gallery' }],
  artboards: [
    { file: 'Main.dc.html', title: 'Anatomy & style tokens', x: 0, y: rowY[0], w: 1440, h: 900 },
    { file: 'CoverEditorial.dc.html', title: 'Cover spread', x: 0, y: rowY[1], w: CW, h: PW },
    { file: 'OpenerEditorial.dc.html', title: 'Chapter opener', x: CW + 120, y: rowY[1], w: SW, h: PW },
    { file: 'SpreadEditorial1.dc.html', title: 'Spread: magazine + text', x: 0, y: rowY[2], w: SW, h: PW },
    { file: 'SpreadEditorial2.dc.html', title: 'Spread: grid + full bleed', x: CW + 120, y: rowY[2], w: SW, h: PW },
    ...['TitlePage', 'OneUpFullBleed', 'OneUpMatted', 'TwoUp', 'ThreeUp', 'FourUpGrid'].map((f, i) => ({ file: `${f}.dc.html`, x: i * (PW + 100), y: rowY[3], w: PW, h: PW })),
    ...['HeroStrip', 'Mosaic6', 'TextPhoto', 'ContactSheet', 'Colophon'].map((f, i) => ({ file: `${f}.dc.html`, x: i * (PW + 100), y: rowY[4], w: PW, h: PW })),
    { file: 'LetterFourUp.dc.html', title: 'Letter 8.5 × 11 check', x: 5 * (PW + 100), y: rowY[4], w: PW, h: 1056 + 2 * BLEED },
    { file: 'CoverGallery.dc.html', title: 'A · Cover spread', x: 0, y: 0, w: CW, h: PW, page: 'page-2' },
    { file: 'OpenerGallery.dc.html', title: 'A · Chapter opener', x: CW + 120, y: 0, w: SW, h: PW, page: 'page-2' },
    { file: 'SpreadGallery1.dc.html', title: 'A · Spread: matted + 3-up', x: 0, y: 960, w: SW, h: PW, page: 'page-2' },
    { file: 'SpreadGallery2.dc.html', title: 'A · Spread: panorama', x: CW + 120, y: 960, w: SW, h: PW, page: 'page-2' },
  ],
  annotations: [
    { id: 'how-to-read', x: 1560, y: 0, w: 420, page: 'page-1', text: 'How to read these boards\nRed tint = bleed (trimmed off). Red line = trim. Blue dashed = safety, nothing important outside it. Hatched strip = gutter safety next to the spine.\nPhotos are gradient stand-ins; your Immich photos replace them.' },
    { id: 'decided', x: 1560, y: 260, w: 420, page: 'page-1', text: 'Decided 2026-09-11\nStyle: warm editorial. Spine text as drawn. Panoramas across the gutter stay available as a template option. Clean-gallery sketches kept on the second page for reference.' },
    { id: 'lib', x: 0, y: rowY[3] - 150, w: 560, page: 'page-1', text: 'Template library\nEach slot is tagged with its number and preferred ratio. These become the JSON templates the auto-paginator picks from. Last board checks the same grid on 8.5 × 11.' },
    { id: 'unchosen', x: 0, y: -160, w: 520, page: 'page-2', text: 'Style A · clean gallery — not chosen. Kept for reference; may return later as a second theme.' },
  ],
  launch: { view: 'canvas', page: 'page-1' },
};
writeFileSync(join(BOOK_DIR, 'canvas.json'), JSON.stringify(bookCanvas, null, 2));
console.log(`wrote ${Object.keys(appBoards).length} app boards and ${Object.keys(B).length} book boards`);
