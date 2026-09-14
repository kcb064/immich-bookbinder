import { renderToStaticMarkup } from 'react-dom/server';
import { FORMAT_PRESETS, THEMES, type BookAsset, type Page } from '@bookbinder/shared';
import { paginate } from '@bookbinder/layout';
import { describe, expect, it } from 'vitest';
import { autoCaption, dateRangeLabel, formatTakenDate } from './captions.js';
import { PageView, pagePhotos, type ImageSrc } from './PageView.js';
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
    const base: BookAsset = { id: 'x', ratio: 1, isFavorite: false, city: 'Porto', country: 'Portugal', takenAt: '2026-05-16T09:00:00Z' };
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
