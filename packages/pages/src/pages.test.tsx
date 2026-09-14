import { renderToStaticMarkup } from 'react-dom/server';
import { FORMAT_PRESETS, LuluProduct, THEMES, type BookAsset, type BookCover, type Page } from '@bookbinder/shared';
import { TEMPLATES, coverGeometry, paginate } from '@bookbinder/layout';
import { describe, expect, it } from 'vitest';
import { autoCaption, dateRangeLabel, formatTakenDate } from './captions.js';
import { CoverView, coverSlotPx, coverText } from './CoverView.js';
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
    expect(m.chapters?.get('ch1')).toEqual({ title: 'Lisbon', subtitle: undefined, photoCount: 3 });
    const html = renderPrintDocument({ pages, firstPageIndex: 0, format, theme, assets, imageSrc, meta: m, webFonts: false });
    expect(html).toContain('>4<');
    expect(html).not.toContain('>2<');
    expect(html).not.toContain('>3<');
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

  it('makes a cover-only print document whose @page is the cover size', () => {
    const { assets } = fixtures(2);
    const html = renderPrintDocument({ pages: [], firstPageIndex: 0, cover: { cover, geometry: g }, format, theme, assets, imageSrc, meta, webFonts: false });
    expect(html).toContain(`@page { size: ${g.widthIn}in ${g.heightIn}in; margin: 0; }`);
    expect(html.match(/class="bb-sheet bb-sheet--cover"/g)).toHaveLength(1);
    expect(html).not.toContain('class="bb-sheet"');
  });
});
