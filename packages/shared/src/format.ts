import { z } from 'zod';

/** Physical book format. All distances in inches; the renderer converts to px/pt. */
export const BookFormat = z.object({
  id: z.string(),
  name: z.string(),
  trimWidthIn: z.number().positive(),
  trimHeightIn: z.number().positive(),
  bleedIn: z.number().nonnegative().default(0.125),
  safetyIn: z.number().nonnegative().default(0.5),
  gutterSafetyIn: z.number().nonnegative().default(0.375),
  minPages: z.number().int().positive().default(24),
  maxPages: z.number().int().positive().default(800),
  pageMultiple: z.number().int().positive().default(2),
  vendor: z.enum(['lulu', 'generic']).default('generic'),
  /** Lulu trim code, e.g. 0850X0850. Only for vendor = lulu. */
  luluTrim: z.string().optional(),
});
export type BookFormat = z.infer<typeof BookFormat>;

/** Lulu casewrap rules verified 2026-09-11: 24–800 pages, 0.125 in bleed, 0.5 in safety. */
export const FORMAT_PRESETS: Record<string, BookFormat> = {
  'lulu-square-8.5': BookFormat.parse({
    id: 'lulu-square-8.5',
    name: 'Square 8.5 × 8.5 in (Lulu)',
    trimWidthIn: 8.5,
    trimHeightIn: 8.5,
    vendor: 'lulu',
    luluTrim: '0850X0850',
  }),
  'lulu-small-square-7.5': BookFormat.parse({
    id: 'lulu-small-square-7.5',
    name: 'Small square 7.5 × 7.5 in (Lulu)',
    trimWidthIn: 7.5,
    trimHeightIn: 7.5,
    vendor: 'lulu',
    luluTrim: '0750X0750',
  }),
  'lulu-letter-portrait': BookFormat.parse({
    id: 'lulu-letter-portrait',
    name: 'US Letter 8.5 × 11 in (Lulu)',
    trimWidthIn: 8.5,
    trimHeightIn: 11,
    vendor: 'lulu',
    luluTrim: '0850X1100',
  }),
  'lulu-letter-landscape': BookFormat.parse({
    id: 'lulu-letter-landscape',
    name: 'US Letter landscape 11 × 8.5 in (Lulu)',
    trimWidthIn: 11,
    trimHeightIn: 8.5,
    vendor: 'lulu',
    luluTrim: '1100X0850',
  }),
  'lulu-landscape-9x7': BookFormat.parse({
    id: 'lulu-landscape-9x7',
    name: 'Landscape 9 × 7 in (Lulu)',
    trimWidthIn: 9,
    trimHeightIn: 7,
    vendor: 'lulu',
    luluTrim: '0900X0700',
  }),
  'lulu-a4-portrait': BookFormat.parse({
    id: 'lulu-a4-portrait',
    name: 'A4 portrait (Lulu)',
    trimWidthIn: 8.27,
    trimHeightIn: 11.69,
    vendor: 'lulu',
    luluTrim: '0827X1169',
  }),
  'home-letter': BookFormat.parse({
    id: 'home-letter',
    name: 'Home print, US Letter',
    trimWidthIn: 8.5,
    trimHeightIn: 11,
    bleedIn: 0,
    safetyIn: 0.4,
    gutterSafetyIn: 0,
    minPages: 2,
    pageMultiple: 1,
  }),
  'home-a4': BookFormat.parse({
    id: 'home-a4',
    name: 'Home print, A4',
    trimWidthIn: 8.27,
    trimHeightIn: 11.69,
    bleedIn: 0,
    safetyIn: 0.4,
    gutterSafetyIn: 0,
    minPages: 2,
    pageMultiple: 1,
  }),
};

export const DEFAULT_FORMAT_ID = 'lulu-square-8.5';

/** Lulu binding / paper / finish choices that form the dotted pod_package_id. */
export const LuluBinding = z.enum(['CW', 'LW', 'PB', 'CO', 'SS']);
export type LuluBinding = z.infer<typeof LuluBinding>;
export const LuluPaper = z.enum(['080CW444', '060UW444', '060UC444']);
export type LuluPaper = z.infer<typeof LuluPaper>;
export const LuluFinish = z.enum(['G', 'M']);
export type LuluFinish = z.infer<typeof LuluFinish>;

export const LuluProduct = z.object({
  binding: LuluBinding.default('CW'),
  paper: LuluPaper.default('080CW444'),
  finish: LuluFinish.default('M'),
  /** PRE = premium color; STD = standard. Photo books want PRE. */
  quality: z.enum(['PRE', 'STD']).default('PRE'),
});
export type LuluProduct = z.infer<typeof LuluProduct>;

/** Builds the dotted pod_package_id, e.g. 0850X0850.FC.PRE.CW.080CW444.MXX */
export function luluPodPackageId(format: BookFormat, product: LuluProduct): string {
  if (!format.luluTrim) throw new Error(`Format ${format.id} has no Lulu trim code`);
  return `${format.luluTrim}.FC.${product.quality}.${product.binding}.${product.paper}.${product.finish}XX`;
}

export const PX_PER_IN = 96;
export const PT_PER_IN = 72;
export const inToPx = (v: number): number => Math.round(v * PX_PER_IN);
export const inToPt = (v: number): number => v * PT_PER_IN;
