import { renderToStaticMarkup } from 'react-dom/server';
import { FORMAT_PRESETS, LuluProduct, THEMES, resolveTheme, type BookAsset, type BookCover, type Page } from '@bookbinder/shared';
import { TEMPLATES, coverGeometry, paginate } from '@bookbinder/layout';
import { describe, expect, it } from 'vitest';
import { autoCaption, dateRangeLabel, formatTakenDate } from './captions.js';
import { CoverView, coverPxToUnits, coverSlotPx, coverText } from './CoverView.js';
import { PageView, pagePhotos, type ImageSrc } from './PageView.js';
import { bookMetaFor } from './meta.js';
import { renderPrintDocument, sideOf } from './print.js';
import { spreadIndexOfPage, spreadLabel, toSpreads } from './spreads.js';

const format = FORMAT_PRESETS['lulu-square-8.5']!;
const theme = THEMES['warm-editorial']!;

function fixtures(n: number): { assets: Map<string, BookAsset>; pages: Page[] } {
  const assets = new Map<string, BookAsset>();
  for (let i = 0; i < n; i++) {
    const landscape = i % 3 !== 1;
    assets.set(`a${i}`, {
      id: `a${i}`,
      people: [],
      takenAt: new Date(Date.UTC(2026, 4, 12 + Math.floor(i / 4), 10, i)).toISOString(),
      width: landscape ? 6000 : 4000,
      height: landscape ? 4000 : 6000,
      ratio: landscape ? 1.5 : 0.667,
      city: i % 2 ? 'Lisbon' : undefined,
      country: 'Portugal',
      isFavorite: false,
      fileName: `IMG_${1000 + i}.JPG`,
    });
  }
  let c = 0;
  const { pages } = paginate(
    [...assets.values()].map((a) => ({ id: a.id, ratio: a.ratio, takenAt: a.takenAt })),
    { format, targetPages: 24, makeId: () => `p${c++}` },
  );
  return { assets, pages };
}

const imageSrc: ImageSrc = ({ asset, wIn, hIn }) => `img://${asset.id}?w=${wIn.toFixed(2)}&h=${hIn.toFixed(2)}`;
const meta = { title: 'Portugal', photoCount: 12, dateRange: 'May 12 – 14, 2026' };

describe('captions', () => {
  it('formats dates and ranges', () => {
    expect(formatTakenDate('2026-05-12T10:00:00.000Z')).toBe('May 12, 2026');
    expect(dateRangeLabel([{ takenAt: '2026-05-12T10:00:00Z' }, { takenAt: '2026-05-21T10:00:00Z' }])).toBe('May 12 – 21, 2026');
    expect(dateRangeLabel([{ takenAt: '2026-05-12T10:00:00Z' }])).toBe('May 12, 2026');
    expect(dateRangeLabel([{ takenAt: undefined }])).toBe('');
  });

  it('prefers a description, then place · date', () => {
    const base: BookAsset = { id: 'x', ratio: 1, isFavorite: false, people: [], city: 'Porto', country: 'Portugal', takenAt: '2026-05-16T09:00:00Z' };
    expect(autoCaption([base])).toBe('Porto, Portugal · May 16, 2026');
    expect(autoCaption([{ ...base, description: '  Ribeira at dawn ' }])).toBe('Ribeira at dawn');
    expect(autoCaption([undefined])).toBe('');
  });
});

describe('PageView', () => {
  it('renders the title page text and every photo slot with the right image request', () => {
    const { assets, pages } = fixtures(12);
    const title = renderToStaticMarkup(<PageView page={pages[0]!} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={meta} />);
    expect(title).toContain('Portugal');
    expect(title).toContain('May 12 – 14, 2026 · 12 photographs');
    expect(title).not.toContain('<img');

    const body = pages.find((p) => p.slots.some((s) => s.assetId))!;
    const html = renderToStaticMarkup(<PageView page={body} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={meta} folio={3} side="left" />);
    const imgs = html.match(/<img /g) ?? [];
    expect(imgs).toHaveLength(pagePhotos(body, assets).filter(Boolean).length);
    expect(html).toContain('object-fit:cover');
    expect(html).toContain('class="bb-folio"');
    expect(html).toContain('>3<');
    // A full-bleed slot spans the whole 8.75 in sheet; a matted slot is smaller.
    if (body.templateId === 'one-up-full-bleed') expect(html).toContain('w=8.75');
  });

  it('scales the whole page with a transform', () => {
    const { assets, pages } = fixtures(2);
    const html = renderToStaticMarkup(<PageView page={pages[0]!} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={meta} scale={0.25} />);
    expect(html).toContain('width:210px;height:210px');
    expect(html).toContain('transform:scale(0.25)');
  });
});

describe('designer overrides (M6)', () => {
  it('places a framed slot by its frame, rotated and stacked, and asks for an image of the frame size', () => {
    const { assets } = fixtures(2);
    // 1 in from the trim corner, 4 x 2 in, on the 8.5 in square page (bleed 0.125 in => +12 px).
    const page: Page = { id: 'x', index: 2, templateId: 'one-up-full-bleed', custom: true, slots: [{ slotId: 'p1', assetId: 'a0', frame: { x: 1 / 8.5, y: 1 / 8.5, w: 4 / 8.5, h: 2 / 8.5, rotation: 15, z: 3 } }] };
    const html = renderToStaticMarkup(<PageView page={page} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={meta} />);
    expect(html).toContain('left:108px;top:108px;width:384px;height:192px');
    expect(html).toContain('z-index:3');
    expect(html).toContain('transform:rotate(15deg)');
    expect(html).toContain('img://a0?w=4.00&amp;h=2.00');
    // Without the frame the template's full-bleed box is used, as before.
    const plain = renderToStaticMarkup(<PageView page={{ ...page, slots: [{ slotId: 'p1', assetId: 'a0' }] }} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={meta} />);
    expect(plain).toContain('img://a0?w=8.75&amp;h=8.75');
    expect(plain).not.toContain('rotate(');
  });

  it('draws ad-hoc text and photo boxes with the theme faces and the requested style', () => {
    const { assets } = fixtures(2);
    const page: Page = {
      id: 'x',
      index: 2,
      templateId: 'blank',
      custom: true,
      slots: [
        { slotId: 'text-1', role: 'text', text: 'Hello\nworld', frame: { x: 0.1, y: 0.1, w: 0.5, h: 0.1 }, style: { font: 'display', sizePt: 24, align: 'center', italic: true } },
        { slotId: 'photo-1', role: 'photo', assetId: 'a1', frame: { x: 0.5, y: 0.5, w: 0.25, h: 0.25 } },
        { slotId: 'text-2', role: 'text', text: '', frame: { x: 0.1, y: 0.8, w: 0.5, h: 0.1 } },
      ],
    };
    const html = renderToStaticMarkup(<PageView page={page} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={meta} />);
    expect(html).toContain('bb-text--box');
    expect(html).toContain('white-space:pre-wrap;overflow-wrap:break-word;overflow:hidden">Hello\nworld</div>');
    expect(html).toContain('font-size:32px'); // 24 pt
    expect(html).toContain('text-align:center');
    expect(html).toContain('font-style:italic');
    expect(html).toContain('Newsreader');
    expect(html).toContain('img://a1?w=2.13&amp;h=2.13');
    expect(html).toContain('bb-slot--adhoc');
    // Empty text boxes are not printed; they only show while designing.
    expect(html.match(/bb-text--box/g)).toHaveLength(1);
    const designing = renderToStaticMarkup(<PageView page={page} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={meta} onSlotClick={() => undefined} onSlotPointerDown={() => undefined} />);
    expect(designing.match(/bb-text--box/g)).toHaveLength(2);
    expect(designing).toContain('bb-text--empty');
    expect(designing).toContain('aria-label="Text text-1"');
  });

  it('prints the same page markup that the editor draws', () => {
    const { assets } = fixtures(2);
    const page: Page = { id: 'x', index: 0, templateId: 'one-up-full-bleed', custom: true, slots: [{ slotId: 'p1', assetId: 'a0', frame: { x: 0.1, y: 0.1, w: 0.4, h: 0.3 } }] };
    const doc = renderPrintDocument({ pages: [page], firstPageIndex: 0, format, theme, assets, imageSrc, meta, webFonts: false, folios: false });
    const editor = renderToStaticMarkup(<PageView page={page} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={meta} />);
    // React hoists image preloads ahead of the markup; the page itself is byte-identical.
    const pageOnly = (html: string) => html.slice(html.indexOf('<div class="bb-page"'), html.indexOf('</div></div></div>') + '</div></div></div>'.length);
    expect(pageOnly(doc)).toBe(pageOnly(editor));
    expect(pageOnly(doc)).toContain('left:94px;top:94px;width:326px;height:245px');
  });

  it('keeps a slot sent behind everything above the paper at print scale (own stacking context)', () => {
    const { assets } = fixtures(2);
    const page: Page = { id: 'x', index: 0, templateId: 'two-up', custom: true, slots: [{ slotId: 'p1', assetId: 'a0', frame: { x: 0.1, y: 0.1, w: 0.4, h: 0.3, z: -1 } }] };
    const html = renderToStaticMarkup(<PageView page={page} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={meta} />);
    expect(html).toContain('z-index:-1');
    // Without `isolation` the negative z-index box paints under the page background once no transform applies.
    expect(html).toMatch(/class="bb-page__inner" style="[^"]*isolation:isolate/);
    const cover = renderToStaticMarkup(<CoverView cover={{ templateId: 'cover-editorial', slots: [] }} geometry={coverGeometry(format, LuluProduct.parse({}), 24)} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={meta} />);
    expect(cover).toMatch(/class="bb-cover__inner" style="[^"]*isolation:isolate/);
  });
});

describe('themes and overrides (M7)', () => {
  it('resolves a book theme with its overrides and falls back to the default theme', () => {
    expect(resolveTheme('nope')).toEqual(THEMES['warm-editorial']);
    const t = resolveTheme('night-gallery', { paper: '#101010', captionSizePx: 16, frameStyle: 'mat' });
    expect(t).toMatchObject({ id: 'night-gallery', paper: '#101010', captionSizePx: 16, frameStyle: 'mat', ink: THEMES['night-gallery']!.ink });
    expect(resolveTheme('night-gallery', {})).toEqual(THEMES['night-gallery']);
  });

  it('frames filled photo slots but never bleed slots, with the paper colour and caption size applied', () => {
    const { assets } = fixtures(12);
    const matted: Page = { id: 'm', index: 2, templateId: 'two-up', slots: [{ slotId: 'p1', assetId: 'a0' }, { slotId: 'p2', assetId: 'a1' }] };
    const bleed: Page = { id: 'b', index: 3, templateId: 'one-up-full-bleed', slots: [{ slotId: 'p1', assetId: 'a2' }] };
    const t = resolveTheme('warm-editorial', { paper: '#123456', captionSizePx: 20, frameStyle: 'hairline' });
    const html = renderToStaticMarkup(<PageView page={matted} format={format} theme={t} assets={assets} imageSrc={imageSrc} meta={meta} />);
    expect(html).toContain('background:#123456');
    expect(html).toContain(`border:1px solid ${t.caption}`);
    const hero = renderToStaticMarkup(<PageView page={bleed} format={format} theme={t} assets={assets} imageSrc={imageSrc} meta={meta} />);
    expect(hero).not.toContain('border:1px solid');
    const plain = renderToStaticMarkup(<PageView page={matted} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={meta} />);
    expect(plain).not.toContain('border:1px solid');
    const shadow = renderToStaticMarkup(<PageView page={matted} format={format} theme={resolveTheme('warm-editorial', { frameStyle: 'shadow' })} assets={assets} imageSrc={imageSrc} meta={meta} />);
    expect(shadow).toContain('box-shadow:0 2px 6px');
  });
});

describe('print document', () => {
  it('emits one sheet per page with the @page size of trim plus bleed', () => {
    const { assets, pages } = fixtures(12);
    const html = renderPrintDocument({ pages: pages.slice(0, 5), firstPageIndex: 0, format, theme, assets, imageSrc, meta, webFonts: false });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('@page { size: 8.75in 8.75in; margin: 0; }');
    expect(html.match(/class="bb-sheet"/g)).toHaveLength(5);
    expect(html).not.toContain('fonts.googleapis.com');
    // Title page carries no folio; page index 1 (printed 2) does.
    expect(html).toContain('>2<');
    expect(html).not.toContain('>1<');
  });

  it('prints the colophon with the share QR code and link, and nothing without a share (M7)', () => {
    const { assets, pages } = fixtures(12);
    const colophon = pages[pages.length - 1]!;
    expect(colophon.templateId).toBe('colophon');
    const withShare = bookMetaFor({ title: 'Portugal', pages }, assets.values(), 12, { shareUrl: 'https://books.example.com/s/abc123' });
    const html = renderToStaticMarkup(<PageView page={colophon} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={withShare} />);
    expect(html).toContain('class="bb-qr"');
    expect(html).toContain('books.example.com/s/abc123');
    expect(html).toContain('See this book online');
    expect(html).toContain('12 photographs');
    expect(html).toContain('immich-bookbinder');
    const plain = renderToStaticMarkup(<PageView page={colophon} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={meta} />);
    expect(plain).not.toContain('bb-qr');
    expect(plain).not.toContain('See this book online');
    // The same page prints identically through the print document.
    const doc = renderPrintDocument({ pages: [colophon], firstPageIndex: colophon.index, format, theme, assets, imageSrc, meta: withShare, webFonts: false });
    expect(doc).toContain(html);
  });

  it('alternates sides starting with a recto', () => {
    expect([0, 1, 2, 3].map(sideOf)).toEqual(['right', 'left', 'right', 'left']);
  });
});

describe('spreads', () => {
  it('pairs pages after the first recto', () => {
    const { pages } = fixtures(6);
    const spreads = toSpreads(pages);
    expect(spreads[0]).toMatchObject({ left: undefined, rightNumber: 1 });
    expect(spreads[1]).toMatchObject({ leftNumber: 2, rightNumber: 3 });
    expect(spreads.length).toBe(1 + Math.ceil((pages.length - 1) / 2));
    expect(spreadIndexOfPage(0)).toBe(0);
    expect(spreadIndexOfPage(1)).toBe(1);
    expect(spreadIndexOfPage(2)).toBe(1);
    expect(spreadIndexOfPage(3)).toBe(2);
    expect(spreadLabel(spreads[1]!)).toBe('pages 2–3');
    expect(spreadLabel(spreads[0]!)).toBe('page 1');
  });
});

describe('chapter openers', () => {
  it('draws the chapter title, subtitle and photo count on the title page and nothing without a chapter', () => {
    const { assets } = fixtures(4);
    const page: Page = { id: 'ct', index: 4, templateId: 'chapter-title', chapterId: 'ch1', slots: [] };
    const chapters = new Map([['ch1', { title: 'Sintra', subtitle: 'May 14, 2026', photoCount: 7 }]]);
    const html = renderToStaticMarkup(<PageView page={page} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={{ ...meta, chapters }} />);
    expect(html).toContain('Sintra');
    expect(html).toContain('May 14, 2026');
    expect(html).toContain('7 photographs');
    expect(html).toContain('class="bb-rule"');
    const orphan = renderToStaticMarkup(<PageView page={{ ...page, chapterId: 'gone' }} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={{ ...meta, chapters }} />);
    expect(orphan).not.toContain('bb-text');
    expect(orphan).not.toContain('bb-rule');
    // A user-typed title wins and long titles shrink to fit one line.
    const typed = renderToStaticMarkup(<PageView page={{ ...page, slots: [{ slotId: 'title', text: 'Serra de Sintra and the coast' }] }} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={{ ...meta, chapters }} />);
    expect(typed).toContain('Serra de Sintra and the coast');
    const size = Number(/font-size:(\d+)px/.exec(typed)?.[1]);
    expect(size).toBeLessThan(80);
  });

  it('counts a chapter\x27s photos from its pages and prints no folio on opener pages', () => {
    const { assets } = fixtures(4);
    const pages: Page[] = [
      { id: 't', index: 0, templateId: 'title-page', slots: [] },
      { id: 'o', index: 1, templateId: 'chapter-photo', chapterId: 'ch1', slots: [{ slotId: 'p1', assetId: 'a0' }] },
      { id: 'c', index: 2, templateId: 'chapter-title', chapterId: 'ch1', slots: [] },
      { id: 'b', index: 3, templateId: 'two-up', chapterId: 'ch1', slots: [{ slotId: 'p1', assetId: 'a1' }, { slotId: 'p2', assetId: 'a2' }] },
    ];
    const m = bookMetaFor({ title: 'T', chapters: [{ id: 'ch1', title: 'Lisbon', startsAtPage: 1 }], pages }, assets.values(), 3);
    expect(m.chapters?.get('ch1')).toEqual({ title: 'Lisbon', subtitle: undefined, photoCount: 3, points: [] });
    const html = renderPrintDocument({ pages, firstPageIndex: 0, format, theme, assets, imageSrc, meta: m, webFonts: false });
    expect(html).toContain('>4<');
    expect(html).not.toContain('>2<');
    expect(html).not.toContain('>3<');
  });

  it('draws an offline map of the chapter on its title page when the rules ask for one (M7)', () => {
    const { assets } = fixtures(4);
    const located = new Map([...assets].map(([id, a], i) => [id, { ...a, lat: 38.7 + i * 0.01, lon: -9.14 + i * 0.02 }]));
    const pages: Page[] = [
      { id: 'o', index: 1, templateId: 'chapter-photo', chapterId: 'ch1', slots: [{ slotId: 'p1', assetId: 'a0' }] },
      { id: 'c', index: 2, templateId: 'chapter-title', chapterId: 'ch1', slots: [] },
      { id: 'b', index: 3, templateId: 'two-up', chapterId: 'ch1', slots: [{ slotId: 'p1', assetId: 'a1' }, { slotId: 'p2', assetId: 'a2' }] },
    ];
    const book = { title: 'T', chapters: [{ id: 'ch1', title: 'Lisbon', startsAtPage: 1 }], pages };
    const off = bookMetaFor(book, located.values(), 3);
    expect(off.chapters?.get('ch1')?.points).toHaveLength(3);
    expect(off.chapterMaps).toBeUndefined();
    const on = bookMetaFor({ ...book, rules: { chapterMaps: true } as never }, located.values(), 3);
    expect(on.chapterMaps).toBe(true);
    const drawn = renderToStaticMarkup(<PageView page={pages[1]!} format={format} theme={theme} assets={located} imageSrc={imageSrc} meta={on} />);
    expect(drawn).toContain('class="bb-map"');
    expect(drawn.match(/<circle/g)).toHaveLength(3);
    expect(drawn).toContain('<path d="M');
    const hidden = renderToStaticMarkup(<PageView page={pages[1]!} format={format} theme={theme} assets={located} imageSrc={imageSrc} meta={off} />);
    expect(hidden).not.toContain('bb-map');
    // No coordinates: the rule is on but there is nothing to draw.
    const nowhere = renderToStaticMarkup(<PageView page={pages[1]!} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={bookMetaFor({ ...book, rules: { chapterMaps: true } as never }, assets.values(), 3)} />);
    expect(nowhere).not.toContain('bb-map');
  });
});

describe('cover', () => {
  const cover: BookCover = { templateId: 'cover-editorial', slots: [{ slotId: 'p1', assetId: 'a0' }], blurb: 'A week in Portugal.' };
  const g = coverGeometry(format, LuluProduct.parse({}), 48);

  it('falls back to the book title and dates for text slots', () => {
    expect(coverText(cover, 'title', meta)).toBe('Portugal');
    expect(coverText(cover, 'subtitle', meta)).toBe('May 12 – 14, 2026');
    expect(coverText(cover, 'spine', meta)).toBe('Portugal');
    expect(coverText(cover, 'back-blurb', meta)).toBe('A week in Portugal.');
    expect(coverText({ ...cover, spineText: 'PT 2026', slots: [{ slotId: 'title', text: 'Lisboa' }] }, 'title', meta)).toBe('Lisboa');
    expect(coverText({ ...cover, spineText: 'PT 2026' }, 'spine', meta)).toBe('PT 2026');
  });

  it('maps back, spine and front onto the sheet and runs bleed slots to the sheet edge', () => {
    const t = TEMPLATES.find((x) => x.id === 'cover-editorial')!;
    const hero = coverSlotPx(t.slots.find((s) => s.id === 'p1')!, format, g, 100);
    expect(hero).toEqual({ x: 0, y: 0, w: Math.round(g.widthIn * 100), h: Math.round(g.heightIn * 100) });
    const title = coverSlotPx(t.slots.find((s) => s.id === 'title')!, format, g, 100);
    expect(title.x).toBeGreaterThanOrEqual(Math.round(g.frontLeftIn * 100));
    const blurb = coverSlotPx(t.slots.find((s) => s.id === 'back-blurb')!, format, g, 100);
    expect(blurb.x + blurb.w).toBeLessThan(Math.round((g.wrapIn + 8.5) * 100));
    const spine = coverSlotPx(t.slots.find((s) => s.id === 'spine')!, format, g, 100);
    expect(spine).toEqual({ x: Math.round((g.wrapIn + 8.5) * 100), y: Math.round(g.wrapIn * 100), w: Math.round(g.spineIn * 100), h: 850 });
  });

  it('draws the hero, the texts and a rotated spine; hides the spine text when the spine is thin', () => {
    const { assets } = fixtures(2);
    const html = renderToStaticMarkup(<CoverView cover={cover} geometry={g} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={meta} />);
    expect(html).toContain('img://a0?');
    expect(html).toContain('>Portugal<');
    expect(html).toContain('A week in Portugal.');
    expect(html).toContain('bb-text--spine');
    expect(html).toContain('rotate(-90deg)');
    const thin = coverGeometry(format, LuluProduct.parse({ binding: 'PB' }), 24);
    expect(thin.spineIn).toBeLessThan(0.25);
    const html2 = renderToStaticMarkup(<CoverView cover={cover} geometry={thin} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={meta} />);
    expect(html2).not.toContain('bb-text--spine');
  });

  it('honours frames and ad-hoc boxes on the cover and inverts the sheet mapping', () => {
    const { assets } = fixtures(2);
    const framed: BookCover = {
      ...cover,
      slots: [
        { slotId: 'p1', assetId: 'a0', frame: { x: 0.1, y: 0.1, w: 0.8, h: 0.5 } },
        { slotId: 'text-1', role: 'text', text: 'Back note', frame: { x: -0.9, y: 0.2, w: 0.5, h: 0.1 } },
      ],
    };
    const html = renderToStaticMarkup(<CoverView cover={framed} geometry={g} format={format} theme={theme} assets={assets} imageSrc={imageSrc} meta={meta} />);
    const hero = coverSlotPx({ id: 'p1', x: 0.1, y: 0.1, w: 0.8, h: 0.5 }, format, g);
    expect(html).toContain(`left:${hero.x}px;top:${hero.y}px;width:${hero.w}px;height:${hero.h}px`);
    expect(html).toContain('Back note');
    // The front panel starts after wrap + trim + spine; the spine itself maps to x = 0.
    const front = coverPxToUnits(Math.round(g.frontLeftIn * 96) + 96, Math.round(g.wrapIn * 96), format, g);
    expect(front.x).toBeCloseTo(1 / 8.5, 3);
    expect(front.y).toBeCloseTo(0, 6);
    expect(coverPxToUnits(Math.round(g.wrapIn * 96), 0, format, g).x).toBeCloseTo(-1, 6);
    expect(coverPxToUnits(Math.round((g.wrapIn + 8.5 + g.spineIn / 2) * 96), 0, format, g).x).toBe(0);
  });

  it('makes a cover-only print document whose @page is the cover size', () => {
    const { assets } = fixtures(2);
    const html = renderPrintDocument({ pages: [], firstPageIndex: 0, cover: { cover, geometry: g }, format, theme, assets, imageSrc, meta, webFonts: false });
    expect(html).toContain(`@page { size: ${g.widthIn}in ${g.heightIn}in; margin: 0; }`);
    expect(html.match(/class="bb-sheet bb-sheet--cover"/g)).toHaveLength(1);
    expect(html).not.toContain('class="bb-sheet"');
  });
});
