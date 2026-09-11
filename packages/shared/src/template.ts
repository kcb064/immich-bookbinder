import { z } from 'zod';

export const SlotRole = z.enum(['hero', 'photo', 'title', 'text', 'caption', 'map', 'qr', 'folio']);
export type SlotRole = z.infer<typeof SlotRole>;

/**
 * A slot on a page. Geometry is in fractions of the trim box (0..1), so the same template
 * works on every format. Values may go below 0 or above 1 to reach into the bleed.
 */
export const SlotSpec = z.object({
  id: z.string(),
  role: SlotRole,
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  /** Preferred photo aspect ratios (w/h) for this slot; the paginator matches photos to slots. */
  aspect: z.array(z.number().positive()).default([]),
  /** 3 = hero, 2 = supporting, 1 = small. Higher-scored photos go to higher importance. */
  importance: z.number().int().min(1).max(3).default(2),
  /** Whether the slot runs into the bleed on the edges it touches. */
  bleed: z.boolean().default(false),
});
export type SlotSpec = z.infer<typeof SlotSpec>;

export const TemplateKind = z.enum(['page', 'spread', 'cover']);
export type TemplateKind = z.infer<typeof TemplateKind>;

export const Template = z.object({
  id: z.string(),
  name: z.string(),
  kind: TemplateKind.default('page'),
  /** Number of photo slots (hero + photo roles). */
  photoCount: z.number().int().nonnegative(),
  /** For spreads: whether a photo may cross the gutter. */
  crossesGutter: z.boolean().default(false),
  /** Tags the paginator uses: 'opener', 'panorama', 'contact', 'text', 'closing'. */
  tags: z.array(z.string()).default([]),
  slots: z.array(SlotSpec),
});
export type Template = z.infer<typeof Template>;
