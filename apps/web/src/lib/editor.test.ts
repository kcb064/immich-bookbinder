import { describe, expect, it } from 'vitest';
import type { BookAsset, Page } from '@bookbinder/shared';
import { getTemplate, photoSlots, placedAssetIds } from '@bookbinder/layout';
import {
  addPhoto,
  historyPush,
  historyRedo,
  historyUndo,
  insertBlankPage,
  movePage,
  pageAssetIds,
  ratiosOf,
  removePage,
  removePhoto,
  setCaption,
  setTemplate,
  swapSlots,
  unplacedAssets,
  userCaption,
} from './editor.ts';

const asset = (id: string, ratio = 1.5): BookAsset => ({ id, ratio, isFavorite: false });
const assets = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => asset(id, i % 2 ? 0.667 : 1.5));
const ratios = ratiosOf(assets);

const pages: Page[] = [
  { id: 't', index: 0, templateId: 'title-page', slots: [] },
  { id: 'p1', index: 1, templateId: 'two-up', slots: [{ slotId: 'p1', assetId: 'a' }, { slotId: 'p2', assetId: 'b', crop: { focalX: 0.2, focalY: 0.2, zoom: 1 } }] },
  { id: 'p2', index: 2, templateId: 'one-up-matted', slots: [{ slotId: 'p1', assetId: 'c' }, { slotId: 'cap', text: 'Hand-written' }] },
  { id: 'p3', index: 3, templateId: 'blank', slots: [] },
];

let n = 0;
const makeId = () => `new-${n++}`;

describe('swapSlots', () => {
  it('swaps across pages and carries crops along', () => {
    const out = swapSlots(pages, { pageIndex: 1, slotId: 'p2' }, { pageIndex: 2, slotId: 'p1' });
    expect(pageAssetIds(out[1]!)).toEqual(['a', 'c']);
    expect(pageAssetIds(out[2]!)).toEqual(['b']);
    expect(out[2]!.slots.find((s) => s.slotId === 'p1')?.crop).toEqual({ focalX: 0.2, focalY: 0.2, zoom: 1 });
    expect(out[2]!.slots.find((s) => s.slotId === 'cap')?.text).toBe('Hand-written');
    expect(placedAssetIds(out).sort()).toEqual(['a', 'b', 'c']);
  });

  it('swaps within a page and is a no-op for the same slot', () => {
    const out = swapSlots(pages, { pageIndex: 1, slotId: 'p1' }, { pageIndex: 1, slotId: 'p2' });
    expect(pageAssetIds(out[1]!)).toEqual(['b', 'a']);
    expect(swapSlots(pages, { pageIndex: 1, slotId: 'p1' }, { pageIndex: 1, slotId: 'p1' })).toEqual(pages);
  });
});

describe('removePhoto / addPhoto', () => {
  it('refits the page to one photo fewer, then to blank', () => {
    const one = removePhoto(pages, { pageIndex: 1, slotId: 'p1' }, ratios);
    expect(pageAssetIds(one[1]!)).toEqual(['b']);
    expect(photoSlots(getTemplate(one[1]!.templateId))).toHaveLength(1);
    const none = removePhoto(one, { pageIndex: 1, slotId: photoSlots(getTemplate(one[1]!.templateId))[0]!.id }, ratios);
    expect(none[1]!.templateId).toBe('blank');
  });

  it('adds to the page until full, then inserts a new page after it', () => {
    let out = pages;
    for (const id of ['d', 'e', 'f', 'g']) out = addPhoto(out, 1, id, ratios, makeId).pages;
    expect(pageAssetIds(out[1]!).sort()).toEqual(['a', 'b', 'd', 'e', 'f', 'g']);
    expect(photoSlots(getTemplate(out[1]!.templateId))).toHaveLength(6);
    const overflow = addPhoto(out, 1, 'z', ratios, makeId);
    expect(overflow.pageIndex).toBe(2);
    expect(pageAssetIds(overflow.pages[2]!)).toEqual(['z']);
    expect(overflow.pages.map((p) => p.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('fills a blank page and never adds to the title page', () => {
    const blank = addPhoto(pages, 3, 'd', ratios, makeId);
    expect(blank.pageIndex).toBe(3);
    expect(pageAssetIds(blank.pages[3]!)).toEqual(['d']);
    const title = addPhoto(pages, 0, 'd', ratios, makeId);
    expect(title.pageIndex).toBe(1);
    expect(title.pages[0]!.templateId).toBe('title-page');
    expect(pageAssetIds(title.pages[1]!)).toEqual(['d']);
    expect(title.pages).toHaveLength(5);
  });
});

describe('page order', () => {
  it('moves body pages, keeps the title page first and reindexes', () => {
    const out = movePage(pages, 2, 1);
    expect(out.map((p) => p.id)).toEqual(['t', 'p2', 'p1', 'p3']);
    expect(out.map((p) => p.index)).toEqual([0, 1, 2, 3]);
    expect(movePage(pages, 0, 2)).toEqual(pages);
    expect(movePage(pages, 1, 0).map((p) => p.id)).toEqual(['t', 'p1', 'p2', 'p3']);
    expect(movePage(pages, 1, 99).map((p) => p.id)).toEqual(['t', 'p2', 'p3', 'p1']);
  });

  it('removes and inserts pages', () => {
    const removed = removePage(pages, 1);
    expect(removed.map((p) => p.id)).toEqual(['t', 'p2', 'p3']);
    expect(unplacedAssets(removed, assets).map((a) => a.id)).toEqual(['a', 'b', 'd', 'e', 'f', 'g']);
    const inserted = insertBlankPage(pages, 1, makeId);
    expect(inserted[2]!.templateId).toBe('blank');
    expect(inserted.map((p) => p.index)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('templates and captions', () => {
  it('switches templates of the same count and ignores mismatches', () => {
    const out = setTemplate(pages, 2, 'one-up-full-bleed', ratios);
    expect(out[2]!.templateId).toBe('one-up-full-bleed');
    expect(pageAssetIds(out[2]!)).toEqual(['c']);
    expect(setTemplate(pages, 2, 'two-up', ratios)).toEqual(pages);
  });

  it('sets, reads and clears a user caption', () => {
    expect(userCaption(pages[2]!)).toBe('Hand-written');
    const set = setCaption(pages, 2, 'New caption');
    expect(userCaption(set[2]!)).toBe('New caption');
    const cleared = setCaption(set, 2, '   ');
    expect(userCaption(cleared[2]!)).toBeUndefined();
    // Pages without a caption slot are untouched.
    expect(setCaption(pages, 1, 'x')).toEqual(pages);
  });
});

describe('history', () => {
  it('undoes and redoes', () => {
    const h0 = { present: pages, past: [], future: [] };
    const h1 = historyPush(h0, removePage(pages, 3));
    const h2 = historyPush(h1, removePage(h1.present, 2));
    expect(h2.present).toHaveLength(2);
    const u1 = historyUndo(h2);
    expect(u1.present).toHaveLength(3);
    const u2 = historyUndo(u1);
    expect(u2.present).toBe(pages);
    expect(historyUndo(u2)).toBe(u2);
    const r = historyRedo(u2);
    expect(r.present).toHaveLength(3);
    expect(historyRedo(historyRedo(r))).toEqual(historyRedo(r));
    // A new edit clears the redo stack.
    expect(historyPush(u1, pages).future).toEqual([]);
  });
});
