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
  /** How photos are framed (M7): nothing, a hairline in the caption colour, a soft drop shadow, or a paper mat with a hairline. */
  frameStyle: z.enum(['none', 'hairline', 'shadow', 'mat']).default('none'),
});
export type Theme = z.infer<typeof Theme>;
export type FrameStyle = Theme['frameStyle'];

/** Per-book adjustments to a theme (M7): every field optional, the theme's value applies when absent. */
export const ThemeOverrides = z.object({
  /** Paper colour as #rrggbb. */
  paper: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'paper must be a #rrggbb colour').optional(),
  /** Caption size in CSS px at 96 ppi (the theme's is 13–14). */
  captionSizePx: z.number().min(8).max(24).optional(),
  frameStyle: Theme.shape.frameStyle.optional(),
});
export type ThemeOverrides = z.infer<typeof ThemeOverrides>;

export const FRAME_STYLE_LABELS: Record<FrameStyle, string> = {
  none: 'No frame',
  hairline: 'Hairline',
  shadow: 'Soft shadow',
  mat: 'Paper mat',
};

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
    frameStyle: 'none',
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
    frameStyle: 'none',
  },
  'night-gallery': {
    id: 'night-gallery',
    name: 'Night gallery',
    paper: '#1e1c1a',
    ink: '#efe9df',
    caption: '#a99f93',
    accent: '#d9a066',
    displayFont: "'Manrope', 'Helvetica Neue', Arial, sans-serif",
    bodyFont: "'Source Serif 4', Georgia, serif",
    titleSizePx: 44,
    captionSizePx: 13,
    captionItalic: false,
    outerMarginIn: 0.5,
    photoGapIn: 0.25,
    frameStyle: 'hairline',
  },
};

export const DEFAULT_THEME_ID = 'warm-editorial';

/** Theme ids in the order the UI lists them. */
export const THEME_IDS: readonly string[] = Object.keys(THEMES);

/** The theme a book prints with: its theme (the default when unknown) with the book's overrides applied. */
export function resolveTheme(themeId: string, overrides?: ThemeOverrides | undefined): Theme {
  const base = THEMES[themeId] ?? THEMES[DEFAULT_THEME_ID]!;
  if (!overrides) return base;
  return {
    ...base,
    ...(overrides.paper !== undefined ? { paper: overrides.paper } : {}),
    ...(overrides.captionSizePx !== undefined ? { captionSizePx: overrides.captionSizePx } : {}),
    ...(overrides.frameStyle !== undefined ? { frameStyle: overrides.frameStyle } : {}),
  };
}
