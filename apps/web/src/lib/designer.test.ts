import { describe, expect, it } from 'vitest';
import { FORMAT_PRESETS, type BookCover, type Page } from '@bookbinder/shared';
import { getTemplate, placedAssetIds } from '@bookbinder/layout';
import { addPhoto, historyPush, historyUndo, ratiosOf, removePhoto, setCrop, setSlotText, swapSlots } from './editor.ts';
import {
  addTextBox,
  coverFrame,
  currentFrame,
  deleteSlot,
  dropPhoto,
  duplicateSlot,
  emptyPhotoSlotIds,
  nudgeSlot,
  placePhoto,
  resetPage,
  setBoxText,
  setFrame,
  setTextStyle,
  setZ,
  slotsDelete,
  slotsNudge,
  slotsSetFrame,
  withCoverSlots,
} from './designer.ts';

const square = FORMAT_PRESETS['lulu-square-8.5']!;
const ratios = ratiosOf([{ id: 'a', ratio: 1.5, isFavorite: false, people: [] }, { id: 'b', ratio: 0.667, isFavorite: false, people: [] }, { id: 'z', ratio: 1, isFavorite: false, people: [] }]);
let n = 0;
const makeId = () => `id${n++}`;

const pages: Page[] = [
  { id: 't', index: 0, templateId: 'title-page', slots: [] },
  { id: 'p1', index: 1, templateId: 'two-up', slots: [{ slotId: 'p1', assetId: 'a' }, { slotId: 'p2', assetId: 'b', crop: { focalX: 0.2, focalY: 0.2, zoom: 1 } }] },
  { id: 'p2', index: 2, templateId: 'one-up-matted', slots: [{ slotId: 'p1', assetId: 'c' }, { slotId: 'cap', text: 'Hand-written' }] },
];

describe('frames', () => {
  it('sets a frame on a template slot, rounds it and marks the page custom', () => {
    const out = setFrame(pages, { pageIndex: 1, slotId: 'p1' }, { x: 0.123456, y: 0.2, w: 0.5, h: 0.4, rotation: 10, z: 3 });
    expect(out[1]!.custom).toBe(true);
    expect(out[1]!.slots.find((s) => s.slotId === 'p1')).toEqual({ slotId: 'p1', assetId: 'a', frame: { x: 0.1235, y: 0.2, w: 0.5, h: 0.4, rotation: 10, z: 3 } });
    expect(out[0]).toBe(pages[0]);
    expect(pages[1]!.custom).toBeUndefined();
    // Unknown slot ids and pages are ignored.
    expect(setFrame(pages, { pageIndex: 1, slotId: 'nope' }, { x: 0, y: 0, w: 1, h: 1 })[1]!.slots).toEqual(pages[1]!.slots);
    expect(setFrame(pages, { pageIndex: 9, slotId: 'p1' }, { x: 0, y: 0, w: 1, h: 1 })).toEqual(pages);
    // A frame on a template slot that has no content yet creates the content.
    const empty: Page = { id: 'e', index: 0, templateId: 'two-up', slots: [] };
    expect(setFrame([empty], { pageIndex: 0, slotId: 'p2' }, { x: 0, y: 0, w: 0.5, h: 0.5 })[0]!.slots).toEqual([{ slotId: 'p2', frame: { x: 0, y: 0, w: 0.5, h: 0.5 } }]);
  });

  it('nudges in inches, stacks front and back, and reports the current frame', () => {
    const t = getTemplate('two-up').slots[0]!;
    expect(currentFrame(pages[1]!, 'p1')).toEqual({ x: t.x, y: t.y, w: t.w, h: t.h });
    const moved = nudgeSlot(pages, { pageIndex: 1, slotId: 'p1' }, 0.85, -0.85, square);
    const f = moved[1]!.slots[0]!.frame!;
    expect(f.x).toBeCloseTo(t.x + 0.1, 3);
    expect(f.y).toBeCloseTo(t.y - 0.1, 3);
    const front = setZ(moved, { pageIndex: 1, slotId: 'p1' }, 'front');
    expect(front[1]!.slots[0]!.frame!.z).toBe(2);
    const back = setZ(front, { pageIndex: 1, slotId: 'p1' }, 'back');
    expect(back[1]!.slots[0]!.frame!.z).toBe(0);
  });

  it('survives crop, text and swap edits on the same slot', () => {
    const framed = setFrame(pages, { pageIndex: 1, slotId: 'p1' }, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    const cropped = setCrop(framed, { pageIndex: 1, slotId: 'p1' }, { focalX: 0.3, focalY: 0.3, zoom: 1 });
    expect(cropped[1]!.slots[0]).toMatchObject({ frame: { x: 0.1 }, crop: { focalX: 0.3 } });
    expect(setCrop(cropped, { pageIndex: 1, slotId: 'p1' }, undefined)[1]!.slots[0]).toEqual({ slotId: 'p1', assetId: 'a', frame: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } });
    const swapped = swapSlots(framed, { pageIndex: 1, slotId: 'p1' }, { pageIndex: 1, slotId: 'p2' });
    // Frames stay with their slot; photos and crops travel.
    expect(swapped[1]!.slots.find((s) => s.slotId === 'p1')).toEqual({ slotId: 'p1', frame: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, assetId: 'b', crop: { focalX: 0.2, focalY: 0.2, zoom: 1 } });
    expect(swapped[1]!.slots.find((s) => s.slotId === 'p2')).toEqual({ slotId: 'p2', assetId: 'a' });
    const captioned = setSlotText(setFrame(pages, { pageIndex: 2, slotId: 'cap' }, { x: 0, y: 0.9, w: 1, h: 0.05 }), 2, 'cap', 'Typed');
    expect(captioned[2]!.slots.find((s) => s.slotId === 'cap')).toEqual({ slotId: 'cap', frame: { x: 0, y: 0.9, w: 1, h: 0.05 }, text: 'Typed' });
    // Clearing the text keeps the frame.
    expect(setSlotText(captioned, 2, 'cap', '')[2]!.slots.find((s) => s.slotId === 'cap')).toEqual({ slotId: 'cap', frame: { x: 0, y: 0.9, w: 1, h: 0.05 } });
  });
});

describe('boxes', () => {
  it('adds, styles, duplicates and deletes text boxes', () => {
    const added = addTextBox(pages, 2, 'Hello', makeId);
    expect(added.slotId).toBe('text-id0');
    const box = added.pages[2]!.slots.find((s) => s.slotId === 'text-id0')!;
    expect(box).toMatchObject({ role: 'text', text: 'Hello', style: { font: 'body', sizePt: 11, align: 'left', italic: false } });
    expect(box.frame).toMatchObject({ x: 0.2, y: 0.42, w: 0.6, h: 0.16, z: 2 });
    expect(added.pages[2]!.custom).toBe(true);

    const styled = setTextStyle(added.pages, { pageIndex: 2, slotId: 'text-id0' }, { font: 'display', sizePt: 30, align: 'center', italic: true });
    expect(styled[2]!.slots.find((s) => s.slotId === 'text-id0')!.style).toEqual({ font: 'display', sizePt: 30, align: 'center', italic: true });
    const retyped = setBoxText(styled, { pageIndex: 2, slotId: 'text-id0' }, '');
    expect(retyped[2]!.slots.find((s) => s.slotId === 'text-id0')).toMatchObject({ text: '', style: { sizePt: 30 } });

    const dup = duplicateSlot(styled, { pageIndex: 2, slotId: 'text-id0' }, square, makeId);
    expect(dup.slotId).toBe('text-id1');
    const copy = dup.pages[2]!.slots.find((s) => s.slotId === 'text-id1')!;
    expect(copy.text).toBe('Hello');
    expect(copy.frame!.x).toBeCloseTo(0.2 + 0.25 / 8.5, 4);
    expect(copy.frame!.z).toBe(3);
    // Photos cannot be duplicated.
    expect(duplicateSlot(pages, { pageIndex: 1, slotId: 'p1' }, square, makeId).slotId).toBeUndefined();

    const gone = deleteSlot(dup.pages, { pageIndex: 2, slotId: 'text-id1' });
    expect(gone[2]!.slots.some((s) => s.slotId === 'text-id1')).toBe(false);
  });

  it('deletes template slots by emptying photos and hiding text', () => {
    const noPhoto = deleteSlot(pages, { pageIndex: 1, slotId: 'p2' });
    expect(noPhoto[1]!.slots).toEqual([{ slotId: 'p1', assetId: 'a' }]);
    const framedThenDeleted = deleteSlot(setFrame(pages, { pageIndex: 1, slotId: 'p2' }, { x: 0, y: 0, w: 0.5, h: 0.5 }), { pageIndex: 1, slotId: 'p2' });
    expect(framedThenDeleted[1]!.slots.find((s) => s.slotId === 'p2')).toEqual({ slotId: 'p2', frame: { x: 0, y: 0, w: 0.5, h: 0.5 } });
    const hidden = deleteSlot(pages, { pageIndex: 2, slotId: 'cap' });
    expect(hidden[2]!.slots.find((s) => s.slotId === 'cap')).toEqual({ slotId: 'cap', text: '' });
    expect(slotsDelete(pages[1]!, 'nope')).toEqual(pages[1]!.slots);
  });

  it('places tray photos into empty boxes first, then new boxes, and removes them without refitting', () => {
    const custom: Page = { id: 'c', index: 1, templateId: 'two-up', custom: true, slots: [{ slotId: 'p1', assetId: 'a' }] };
    expect(emptyPhotoSlotIds(custom)).toEqual(['p2']);
    const first = placePhoto([custom], 0, 'b', 0.667, square, makeId);
    expect(first.slotId).toBe('p2');
    expect(first.pages[0]!.slots.find((s) => s.slotId === 'p2')).toEqual({ slotId: 'p2', assetId: 'b' });
    const second = addPhoto(first.pages, 0, 'z', ratios, makeId, square);
    expect(second.pageIndex).toBe(0);
    expect(second.slotId).toBe('photo-id2');
    const box = second.pages[0]!.slots.find((s) => s.slotId === 'photo-id2')!;
    expect(box).toMatchObject({ role: 'photo', assetId: 'z' });
    expect(box.frame).toMatchObject({ x: 0.275, w: 0.45, z: 2 });
    expect(placedAssetIds(second.pages)).toEqual(['a', 'b', 'z']);
    // A third box is offset so it does not sit exactly on the second.
    const third = addPhoto(second.pages, 0, 'q', ratios, makeId, square);
    expect(third.pages[0]!.slots.at(-1)!.frame!.x).toBeCloseTo(0.305, 4);

    const removed = removePhoto(second.pages, { pageIndex: 0, slotId: 'photo-id2' }, ratios);
    expect(removed[0]!.templateId).toBe('two-up');
    expect(removed[0]!.slots.find((s) => s.slotId === 'photo-id2')).toEqual({ slotId: 'photo-id2', role: 'photo', frame: box.frame });
    const emptied = removePhoto(second.pages, { pageIndex: 0, slotId: 'p1' }, ratios);
    expect(emptied[0]!.slots.some((s) => s.slotId === 'p1')).toBe(false);
    expect(emptied[0]!.custom).toBe(true);
  });

  it('resets a page to its template, freeing photos in boxes', () => {
    const designed = addPhoto(setFrame(pages, { pageIndex: 1, slotId: 'p1' }, { x: 0, y: 0, w: 0.5, h: 0.5 }), 1, 'z', ratios, makeId, square).pages;
    const styled = setTextStyle(addTextBox(designed, 1, 'x', makeId).pages, { pageIndex: 1, slotId: 'p1' }, { font: 'body', sizePt: 11, align: 'left', italic: false });
    const reset = resetPage(styled, 1);
    expect(reset[1]!.custom).toBeUndefined();
    expect(reset[1]!.slots).toEqual(pages[1]!.slots);
    expect(resetPage(pages, 7)).toEqual(pages);
  });

  it('drops a tray photo onto a slot (replacing, page stays automatic) or onto the page (new box, page turns custom)', () => {
    // Onto the occupied template slot p2: b goes back to the tray, the crop is dropped, no custom flag.
    const onSlot = dropPhoto(pages, 1, 'z', 1, square, { slotId: 'p2' }, makeId);
    expect(onSlot.slotId).toBe('p2');
    expect(onSlot.pages[1]!.custom).toBeUndefined();
    expect(onSlot.pages[1]!.slots.find((s) => s.slotId === 'p2')).toEqual({ slotId: 'p2', assetId: 'z' });
    expect(placedAssetIds(onSlot.pages)).not.toContain('b');
    // Onto a text slot or the background: a photo box centred on the point, page custom.
    const onPage = dropPhoto(pages, 2, 'z', 1, square, { at: { x: 0.3, y: 0.6 } }, makeId);
    expect(onPage.pages[2]!.custom).toBe(true);
    const box = onPage.pages[2]!.slots.find((s) => s.slotId === onPage.slotId)!;
    expect(box.role).toBe('photo');
    expect(box.frame!.x + box.frame!.w / 2).toBeCloseTo(0.3, 3);
    expect(box.frame!.y + box.frame!.h / 2).toBeCloseTo(0.6, 3);
    const onText = dropPhoto(pages, 2, 'z', 1, square, { slotId: 'cap', at: { x: 0.5, y: 0.5 } }, makeId);
    expect(onText.slotId).not.toBe('cap');
    expect(dropPhoto(pages, 9, 'z', 1, square, {}).slotId).toBeUndefined();
  });
});

describe('cover', () => {
  const cover: BookCover = { templateId: 'cover-editorial', slots: [{ slotId: 'p1', assetId: 'a' }], spineText: 'PT' };
  it('runs the same operations on the cover slots and keeps the rest of the document', () => {
    const t = getTemplate('cover-editorial').slots.find((s) => s.id === 'title')!;
    expect(coverFrame(cover, 'title')).toEqual({ x: t.x, y: t.y, w: t.w, h: t.h });
    expect(coverFrame(cover, 'nope')).toBeUndefined();
    const moved = withCoverSlots(cover, (c) => slotsSetFrame(c, 'title', { x: -0.9, y: 0.1, w: 0.8, h: 0.15 }));
    expect(moved.spineText).toBe('PT');
    expect(moved.slots).toEqual([{ slotId: 'p1', assetId: 'a' }, { slotId: 'title', frame: { x: -0.9, y: 0.1, w: 0.8, h: 0.15 } }]);
    expect(coverFrame(moved, 'title')).toEqual({ x: -0.9, y: 0.1, w: 0.8, h: 0.15 });
    const cleared = withCoverSlots(moved, (c) => slotsDelete(c, 'p1'));
    expect(cleared.slots.some((s) => s.slotId === 'p1')).toBe(false);
  });
});

describe('coalescing history', () => {
  it('merges quick pushes with the same key into one undo step and keeps others apart', () => {
    const doc = { pages, cover: undefined };
    const h0 = historyPush({ present: doc, past: [], future: [] }, doc);
    expect(h0.past).toHaveLength(0);
    const h1 = historyPush(h0, { ...doc, pages: nudgeSlot(pages, { pageIndex: 1, slotId: 'p1' }, 0.1, 0, square) }, { key: 'nudge:1:p1', now: 1000 });
    const h2 = historyPush(h1, { ...doc, pages: nudgeSlot(h1.present.pages, { pageIndex: 1, slotId: 'p1' }, 0.1, 0, square) }, { key: 'nudge:1:p1', now: 1300 });
    expect(h2.past).toHaveLength(1);
    expect(h2.present.pages[1]!.slots[0]!.frame!.x).toBeCloseTo(getTemplate('two-up').slots[0]!.x + 0.2 / 8.5, 3);
    expect(historyUndo(h2).present).toBe(doc);
    // A different key, or a pause, starts a new step.
    const h3 = historyPush(h2, { ...doc, pages: nudgeSlot(h2.present.pages, { pageIndex: 1, slotId: 'p2' }, 0.1, 0, square) }, { key: 'nudge:1:p2', now: 1400 });
    expect(h3.past).toHaveLength(2);
    const h4 = historyPush(h3, { ...doc, pages: nudgeSlot(h3.present.pages, { pageIndex: 1, slotId: 'p2' }, 0.1, 0, square) }, { key: 'nudge:1:p2', now: 5000 });
    expect(h4.past).toHaveLength(3);
    // Undo then a coalescing push does not merge into the undone step.
    const u = historyUndo(h4);
    expect(u.future).toHaveLength(1);
    const h5 = historyPush(u, { ...doc, pages: [] }, { key: 'nudge:1:p2', now: 5100 });
    expect(h5.past).toHaveLength(3);
    expect(h5.future).toHaveLength(0);
  });
});

describe('slotsNudge with a format', () => {
  it('cannot push a box fully off the page', () => {
    const square = FORMAT_PRESETS['lulu-square-8.5']!;
    const page: Page = { id: 'p', index: 0, templateId: 'one-up-full-bleed', custom: true, slots: [{ slotId: 'p1', assetId: 'a', frame: { x: 0.6, y: 0.2, w: 0.3, h: 0.3 } }] };
    let slots = page.slots;
    for (let i = 0; i < 40; i++) slots = slotsNudge({ templateId: page.templateId, slots }, 'p1', 0.1, 0, square);
    const frame = slots.find((s) => s.slotId === 'p1')!.frame!;
    const bleed = square.bleedIn / square.trimWidthIn;
    expect(frame.x).toBeCloseTo(1 + bleed - 0.25 / square.trimWidthIn, 3);
    // Without a format (the cover), nudges are free.
    const free = slotsNudge({ templateId: page.templateId, slots: page.slots }, 'p1', 3, 0);
    expect(free.find((s) => s.slotId === 'p1')!.frame!.x).toBeCloseTo(3.6, 4);
  });
});
