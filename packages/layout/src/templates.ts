import type { SlotSpec, Template } from '@bookbinder/shared';
import { Template as TemplateSchema } from '@bookbinder/shared';

/**
 * Template library transcribed from the approved design boards (docs/design.md).
 * Geometry is in fractions of the trim box of ONE page. The design was drawn on an
 * 8.5 in (816 px) square page with: bleed 12 px, safety 48 px, gap 24 px.
 * Spreads use x in 0..2 (1 = spine); covers use -1..0 for the back and 0..1 for the front.
 */
const PAGE = 816;
const f = (px: number): number => Math.round((px / PAGE) * 10000) / 10000;
const B = f(12); // bleed
const S = f(48); // safety
const C = f(720); // content box
const GAP = f(24);

const photo = (id: string, x: number, y: number, w: number, h: number, extra: Partial<SlotSpec> = {}): SlotSpec => ({
  id,
  role: 'photo',
  x,
  y,
  w,
  h,
  aspect: [],
  importance: 2,
  bleed: false,
  ...extra,
});
const hero = (id: string, x: number, y: number, w: number, h: number, extra: Partial<SlotSpec> = {}): SlotSpec =>
  photo(id, x, y, w, h, { role: 'hero', importance: 3, ...extra });
const text = (id: string, role: SlotSpec['role'], x: number, y: number, w: number, h: number): SlotSpec => ({
  id,
  role,
  x,
  y,
  w,
  h,
  aspect: [],
  importance: 1,
  bleed: false,
});

const FULL_BLEED = { x: -B, y: -B, w: 1 + 2 * B, h: 1 + 2 * B };

const raw: Template[] = [
  {
    id: 'title-page',
    name: 'Title page',
    kind: 'page',
    photoCount: 0,
    crossesGutter: false,
    tags: ['front-matter'],
    slots: [
      text('title', 'title', S, f(300), C, f(120)),
      text('subtitle', 'text', S, f(430), C, f(40)),
      // Optional foreword paragraph (typed, or written by Claude in M7); empty = nothing drawn.
      text('foreword', 'text', S, f(500), f(560), f(200)),
      text('author', 'caption', S, 1 - S - f(20), C, f(20)),
    ],
  },
  {
    id: 'one-up-full-bleed',
    name: '1 photo, full bleed',
    kind: 'page',
    photoCount: 1,
    crossesGutter: false,
    tags: [],
    slots: [hero('p1', FULL_BLEED.x, FULL_BLEED.y, FULL_BLEED.w, FULL_BLEED.h, { aspect: [1, 1.5, 0.667], bleed: true })],
  },
  {
    id: 'one-up-matted',
    name: '1 photo, matted',
    kind: 'page',
    photoCount: 1,
    crossesGutter: false,
    tags: [],
    slots: [
      hero('p1', S, S, C, C - f(48), { aspect: [1.5, 1] }),
      text('cap', 'caption', S, 1 - S - f(30), C, f(24)),
    ],
  },
  {
    id: 'two-up',
    name: '2 landscape photos',
    kind: 'page',
    photoCount: 2,
    crossesGutter: false,
    tags: [],
    slots: [
      photo('p1', S, S, C, (C - GAP) / 2, { aspect: [1.5, 1.78] }),
      photo('p2', S, S + (C + GAP) / 2, C, (C - GAP) / 2, { aspect: [1.5, 1.78] }),
    ],
  },
  {
    id: 'three-up',
    name: 'Hero over two',
    kind: 'page',
    photoCount: 3,
    crossesGutter: false,
    tags: [],
    slots: [
      hero('p1', S, S, C, f(440), { aspect: [1.6, 1.5] }),
      photo('p2', S, S + f(440) + GAP, (C - GAP) / 2, C - f(440) - GAP, { aspect: [1.333, 1] }),
      photo('p3', S + (C + GAP) / 2, S + f(440) + GAP, (C - GAP) / 2, C - f(440) - GAP, { aspect: [1.333, 1] }),
    ],
  },
  {
    id: 'four-up-grid',
    name: '4 square photos',
    kind: 'page',
    photoCount: 4,
    crossesGutter: false,
    tags: [],
    slots: [0, 1, 2, 3].map((i) =>
      photo(`p${i + 1}`, S + (i % 2) * ((C + GAP) / 2), S + Math.floor(i / 2) * ((C + GAP) / 2), (C - GAP) / 2, (C - GAP) / 2, {
        aspect: [1],
      }),
    ),
  },
  {
    id: 'hero-strip',
    name: 'Full-bleed hero with strip of three',
    kind: 'page',
    photoCount: 4,
    crossesGutter: false,
    tags: [],
    slots: [
      hero('p1', -B, -B, 1 + 2 * B, f(560) + B, { aspect: [1.5, 1.78], bleed: true }),
      ...[0, 1, 2].map((i) => photo(`p${i + 2}`, S + i * ((C + GAP) / 3), f(588), (C - 2 * GAP) / 3, f(136), { aspect: [1.5], importance: 1 })),
      text('cap', 'caption', S, 1 - S - f(20), C, f(20)),
    ],
  },
  {
    id: 'five-up',
    name: 'Two over three',
    kind: 'page',
    photoCount: 5,
    crossesGutter: false,
    tags: [],
    slots: [
      photo('p1', S, S, (C - GAP) / 2, f(360), { aspect: [1, 1.25] }),
      photo('p2', S + (C + GAP) / 2, S, (C - GAP) / 2, f(360), { aspect: [1, 1.25] }),
      ...[0, 1, 2].map((i) => photo(`p${i + 3}`, S + i * ((C + GAP) / 3), S + f(360) + GAP, (C - 2 * GAP) / 3, C - f(360) - GAP, { aspect: [0.667, 0.75], importance: 1 })),
    ],
  },
  {
    id: 'mosaic-6',
    name: 'Mosaic of six',
    kind: 'page',
    photoCount: 6,
    crossesGutter: false,
    tags: [],
    slots: [
      hero('p1', S, S, f(460), f(460), { aspect: [1] }),
      photo('p2', S + f(460) + GAP, S, C - f(460) - GAP, f(218), { aspect: [1.25] }),
      photo('p3', S + f(460) + GAP, S + f(218) + GAP, C - f(460) - GAP, f(218), { aspect: [1.25] }),
      ...[0, 1, 2].map((i) =>
        photo(`p${i + 4}`, S + i * ((C + GAP) / 3), S + f(460) + GAP, (C - 2 * GAP) / 3, C - f(460) - GAP, { aspect: [1.333], importance: 1 }),
      ),
    ],
  },
  // ---- chapter opener as two facing pages: full-bleed hero on the verso, title on the recto
  {
    id: 'chapter-photo',
    name: 'Chapter opener photo',
    kind: 'page',
    photoCount: 1,
    crossesGutter: false,
    tags: ['opener', 'chapter'],
    slots: [hero('p1', FULL_BLEED.x, FULL_BLEED.y, FULL_BLEED.w, FULL_BLEED.h, { aspect: [1, 0.8, 1.5], bleed: true })],
  },
  {
    id: 'chapter-title',
    name: 'Chapter title',
    kind: 'page',
    photoCount: 0,
    crossesGutter: false,
    tags: ['opener', 'chapter'],
    slots: [
      text('title', 'title', f(56), f(96), C, f(140)),
      text('rule', 'folio', f(60), f(236), f(48), f(2)),
      text('subtitle', 'caption', f(60), f(262), C - f(60), f(24)),
      text('body', 'text', f(60), f(320), f(420), f(160)),
      // Offline map of the chapter's photos (M7); drawn only when the book asks for maps.
      { id: 'map', role: 'map', x: f(60), y: f(500), w: f(352), h: f(220), aspect: [1.6], importance: 1, bleed: false },
    ],
  },
  {
    id: 'text-photo',
    name: 'Text column with portrait photo',
    kind: 'page',
    photoCount: 1,
    crossesGutter: false,
    tags: ['text'],
    slots: [
      hero('p1', S + f(300), S, C - f(300), C, { aspect: [0.667, 0.8] }),
      text('title', 'title', S, S + f(8), f(252), f(28)),
      text('date', 'caption', S, S + f(40), f(252), f(24)),
      text('body', 'text', S, S + f(88), f(252), C - f(88)),
    ],
  },
  {
    id: 'contact-sheet',
    name: 'Justified contact sheet',
    kind: 'page',
    photoCount: 12,
    crossesGutter: false,
    tags: ['contact', 'variable-count'],
    slots: [
      // One region slot; the paginator fills it with Immich's justified layout (10–16 photos).
      photo('grid', S, S, C, C - f(40), { importance: 1 }),
      text('cap', 'caption', S, 1 - S - f(22), C, f(20)),
    ],
  },
  {
    id: 'colophon',
    name: 'Colophon with QR code',
    kind: 'page',
    photoCount: 0,
    crossesGutter: false,
    tags: ['back-matter', 'closing'],
    slots: [
      { id: 'qr', role: 'qr', x: S, y: 1 - S - f(200), w: f(120), h: f(120), aspect: [1], importance: 1, bleed: false },
      text('qr-label', 'caption', S + f(144), 1 - S - f(196), C - f(144), f(24)),
      text('qr-url', 'caption', S + f(144), 1 - S - f(170), C - f(144), f(24)),
      text('credits', 'caption', S, 1 - S - f(44), C, f(20)),
      text('date', 'caption', S, 1 - S - f(20), C, f(20)),
    ],
  },
  {
    id: 'blank',
    name: 'Blank page',
    kind: 'page',
    photoCount: 0,
    crossesGutter: false,
    tags: ['filler'],
    slots: [],
  },
  // ---- spreads (x in 0..2, spine at 1)
  {
    id: 'chapter-opener',
    name: 'Chapter opener: photo left, title right',
    kind: 'spread',
    photoCount: 1,
    crossesGutter: false,
    tags: ['opener'],
    slots: [
      hero('p1', -B, -B, 1 + B, 1 + 2 * B, { aspect: [1, 0.8, 1.5], bleed: true }),
      text('title', 'title', 1 + f(56), f(96), C, f(140)),
      text('rule', 'folio', 1 + f(60), f(236), f(48), f(2)),
      text('subtitle', 'caption', 1 + f(60), f(262), C - f(60), f(24)),
      text('body', 'text', 1 + f(60), f(320), f(420), f(160)),
      { id: 'map', role: 'map', x: 1 + f(60), y: f(500), w: f(320), h: f(200), aspect: [1.6], importance: 1, bleed: false },
    ],
  },
  {
    id: 'spread-magazine-text',
    name: 'Spread: magazine grid + text column',
    kind: 'spread',
    photoCount: 4,
    crossesGutter: false,
    tags: ['text'],
    slots: [
      hero('p1', -B, -B, 1 + B - f(20), f(470) + B, { aspect: [1.78, 1.5], bleed: true }),
      photo('p2', f(56), f(486), f(330), f(250), { aspect: [1.333] }),
      photo('p3', f(402), f(486), f(358), f(250), { aspect: [1.5] }),
      text('day', 'title', 1 + f(76), f(72), f(300), f(170)),
      text('date', 'caption', 1 + f(80), f(236), f(300), f(24)),
      text('body', 'text', 1 + f(80), f(290), f(300), f(400)),
      hero('p4', 1 + f(420), f(72), f(340), f(664), { aspect: [0.5, 0.667] }),
      text('cap', 'caption', 1 + f(80), f(720), f(300), f(24)),
    ],
  },
  {
    id: 'spread-grid-fullbleed',
    name: 'Spread: four-grid left, full bleed right',
    kind: 'spread',
    photoCount: 5,
    crossesGutter: false,
    tags: [],
    slots: [
      photo('p1', f(56), f(56), f(420), f(300), { aspect: [1.4] }),
      photo('p2', f(492), f(56), f(268), f(300), { aspect: [0.9] }),
      photo('p3', f(56), f(372), f(268), f(364), { aspect: [0.75] }),
      photo('p4', f(340), f(372), f(420), f(364), { aspect: [1.15] }),
      hero('p5', 1, -B, 1 + B, 1 + 2 * B, { aspect: [1, 1.5], bleed: true }),
      text('cap-title', 'caption', 1 + f(56), f(700), C, f(40)),
      text('cap', 'caption', 1 + f(56), f(748), C, f(24)),
    ],
  },
  {
    id: 'panorama-spread',
    name: 'Panorama across the gutter',
    kind: 'spread',
    photoCount: 1,
    crossesGutter: true,
    tags: ['panorama'],
    slots: [
      hero('p1', -B, f(120), 2 + 2 * B, f(520), { aspect: [2.5, 3, 2], bleed: true }),
      text('cap', 'caption', 1 + S, f(664), C, f(24)),
    ],
  },
  // ---- cover (back = -1..0, front = 0..1; the renderer inserts the spine between them)
  {
    id: 'cover-editorial',
    name: 'Cover: full-bleed wrap, italic title',
    kind: 'cover',
    photoCount: 1,
    crossesGutter: true,
    tags: ['cover'],
    slots: [
      hero('p1', -1 - B, -B, 2 + 2 * B, 1 + 2 * B, { aspect: [2.2, 1.78], bleed: true }),
      // Ends at the safety line (816 - 48 px) so preflight's cover check passes on the template itself.
      text('title', 'title', f(56), 1 - f(120) - f(130), C - f(8), f(130)),
      text('rule', 'folio', f(60), 1 - f(96), f(56), f(2)),
      text('subtitle', 'caption', f(60), 1 - f(60) - f(24), C - f(60), f(24)),
      text('back-blurb', 'text', -1 + f(56), 1 - f(56) - f(70), f(380), f(70)),
      text('spine', 'title', 0, 0, 0.05, 1),
    ],
  },
];

export const TEMPLATES: readonly Template[] = raw.map((t) => TemplateSchema.parse(t));

const byId = new Map(TEMPLATES.map((t) => [t.id, t]));

export function getTemplate(id: string): Template {
  const t = byId.get(id);
  if (!t) throw new Error(`Unknown template: ${id}`);
  return t;
}

/** Page templates (not spreads/covers) that hold exactly `count` photos, most generic first. */
export function pageTemplatesForCount(count: number): Template[] {
  return TEMPLATES.filter((t) => t.kind === 'page' && t.photoCount === count && !t.tags.includes('variable-count') && !t.tags.includes('opener'));
}
