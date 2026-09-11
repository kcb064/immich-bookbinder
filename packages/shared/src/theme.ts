import { z } from 'zod';

/** Visual theme for rendered pages. Values chosen on the design canvas (docs/design.md). */
export const Theme = z.object({
  id: z.string(),
  name: z.string(),
  paper: z.string(),
  ink: z.string(),
  caption: z.string(),
  accent: z.string(),
  displayFont: z.string(),
  bodyFont: z.string(),
  /** Large chapter/cover titles, px at 96 ppi on an 8.5 in page. */
  titleSizePx: z.number(),
  captionSizePx: z.number(),
  captionItalic: z.boolean(),
  outerMarginIn: z.number(),
  photoGapIn: z.number(),
});
export type Theme = z.infer<typeof Theme>;

export const THEMES: Record<string, Theme> = {
  'warm-editorial': {
    id: 'warm-editorial',
    name: 'Warm editorial',
    paper: '#f6f1e8',
    ink: '#2a2622',
    caption: '#6b625a',
    accent: '#b5563a',
    displayFont: "'Newsreader', Georgia, 'Times New Roman', serif",
    bodyFont: "'Source Serif 4', Georgia, serif",
    titleSizePx: 112,
    captionSizePx: 14,
    captionItalic: true,
    outerMarginIn: 56 / 96,
    photoGapIn: 16 / 96,
  },
  'clean-gallery': {
    id: 'clean-gallery',
    name: 'Clean gallery',
    paper: '#fbfbfa',
    ink: '#2b2b2b',
    caption: '#6f6f6f',
    accent: '#2b2b2b',
    displayFont: "'Manrope', 'Helvetica Neue', Arial, sans-serif",
    bodyFont: "'Manrope', 'Helvetica Neue', Arial, sans-serif",
    titleSizePx: 40,
    captionSizePx: 13,
    captionItalic: false,
    outerMarginIn: 0.5,
    photoGapIn: 0.25,
  },
};

export const DEFAULT_THEME_ID = 'warm-editorial';
