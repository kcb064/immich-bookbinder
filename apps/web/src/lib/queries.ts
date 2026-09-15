import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { AiJob, AiTest, Book, BookAsset, ImmichStatus, LuluRemoteJob, LuluStatus, LuluWebhookView, NotificationTest, OrderView, Preflight, ReachabilityReport, RenderJob, SelectionRun, SelectionView, SettingsView, ShareView } from '@bookbinder/shared';
import type { AiJobKind, AiSettingsInput, CreateShareInput, DecisionChoice, ImmichConnectionInput, LuluConnectionInput, LuluEnv, NotificationSettingsInput, PrepareOrderInput, RenderKind, SavedPet, SelectionRules, SelectionSource, UpdateShareInput } from '@bookbinder/shared';
import { del, get, isApiError, post, put } from './api.ts';

/* ---------- Schemas for endpoints without a shared type ---------- */

export const Me = z.object({
  authenticated: z.boolean(),
  /** 'session' (password login), 'cf-access' (proxy header), or null when signed out. */
  via: z.string().nullable().optional(),
});
export type Me = z.infer<typeof Me>;

/** What GET /api/immich/albums returns (the server maps Immich's AlbumResponseDto). */
export const AlbumSummary = z.looseObject({
  id: z.string(),
  name: z.string().default(''),
  description: z.string().nullish(),
  assetCount: z.number().int().nonnegative().default(0),
  shared: z.boolean().default(false),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  /** Proxied thumbnail URL, or null for an empty album. */
  thumbnailUrl: z.string().nullish(),
});
export type AlbumSummary = z.infer<typeof AlbumSummary>;
export const AlbumList = z.array(AlbumSummary);

export const PeopleResponse = z.object({
  people: z.array(z.object({ id: z.string(), name: z.string(), thumbnailUrl: z.string().optional() })),
  total: z.number().int().nonnegative(),
});
export type PeopleResponse = z.infer<typeof PeopleResponse>;
export type PersonSummary = PeopleResponse['people'][number];

/** What GET /api/immich/trips returns: trips detected from geotagged photos in a date range. */
export const TripPlace = z.object({ name: z.string(), bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]), count: z.number().int().nonnegative() });
export type TripPlace = z.infer<typeof TripPlace>;
export const TripSuggestion = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  days: z.number().int().nonnegative(),
  photoCount: z.number().int().nonnegative(),
  places: z.array(TripPlace),
  country: z.string().optional(),
});
export type TripSuggestion = z.infer<typeof TripSuggestion>;
export const TripsResponse = z.object({ from: z.string(), to: z.string(), geotagged: z.number().int().nonnegative(), trips: z.array(TripSuggestion) });
export type TripsResponse = z.infer<typeof TripsResponse>;

export const PlaceHit = z.object({ name: z.string(), region: z.string().nullish(), latitude: z.number(), longitude: z.number() });
export type PlaceHit = z.infer<typeof PlaceHit>;

export const SmartPreview = z.object({ items: z.array(z.object({ id: z.string(), fileName: z.string().nullish(), thumbnailUrl: z.string() })) });
export type SmartPreview = z.infer<typeof SmartPreview>;

/** What GET /api/books returns: a light row per book, not the full document. */
export const BookSummary = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  status: Book.shape.status,
  formatId: z.string(),
  themeId: z.string(),
  pageCount: z.number().int().nonnegative().default(0),
  photoCount: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BookSummary = z.infer<typeof BookSummary>;
export const BookList = z.array(BookSummary);

/* ---------- Query keys ---------- */

export const keys = {
  me: ['auth', 'me'] as const,
  settings: ['settings'] as const,
  immichStatus: ['immich', 'status'] as const,
  albums: ['immich', 'albums'] as const,
  people: ['immich', 'people'] as const,
  trips: (from: string, to: string) => ['immich', 'trips', from, to] as const,
  places: (name: string) => ['immich', 'places', name] as const,
  smart: (q: string) => ['immich', 'smart', q] as const,
  /** The list. Invalidate with `exact: true`: the per-book keys below share the prefix. */
  books: ['books'] as const,
  book: (id: string) => ['books', id] as const,
  bookAssets: (id: string) => ['books', id, 'assets'] as const,
  renders: (id: string) => ['books', id, 'renders'] as const,
  selection: (id: string) => ['books', id, 'selection'] as const,
  preflight: (id: string) => ['books', id, 'preflight'] as const,
  shares: (id: string) => ['books', id, 'shares'] as const,
  aiJobs: (id: string) => ['books', id, 'ai'] as const,
  allOrders: ['orders'] as const,
  orders: (id: string) => ['books', id, 'orders'] as const,
  order: (id: string, oid: string) => ['books', id, 'orders', oid] as const,
};

/* ---------- Auth ---------- */

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: ({ signal }) => get('/api/auth/me', Me, signal),
    staleTime: 60_000,
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => post('/api/auth/login', { password }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post('/api/auth/logout'),
    onSuccess: () => {
      qc.clear();
    },
  });
}

/* ---------- Settings & Immich ---------- */

export function useSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: ({ signal }) => get('/api/settings', SettingsView, signal),
    staleTime: 60_000,
  });
}

/** Cached status of the stored Immich connection (no body: the server uses saved credentials). */
export function useImmichStatus(enabled = true) {
  return useQuery({
    queryKey: keys.immichStatus,
    queryFn: () => post('/api/immich/test', undefined, ImmichStatus),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
    enabled,
  });
}

/** Probe the connection with values typed in the form (not yet saved). */
export function useTestImmich() {
  return useMutation({
    mutationFn: (input?: ImmichConnectionInput) => post('/api/immich/test', input, ImmichStatus),
  });
}

export function useSaveImmich() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImmichConnectionInput) => put('/api/settings/immich', input),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.settings }),
        qc.invalidateQueries({ queryKey: ['immich'] }),
      ]);
    },
  });
}

export function useClearImmich() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => del('/api/settings/immich'),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.settings }),
        qc.invalidateQueries({ queryKey: ['immich'] }),
      ]);
    },
  });
}

export function useSavePublicUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (publicUrl: string) => put('/api/settings/public-url', { publicUrl: publicUrl || null }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.settings });
    },
  });
}

/** Replaces the saved pets (M7). */
export function useSavePets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pets: SavedPet[]) => put('/api/settings/pets', { pets }, SettingsView),
    onSuccess: (view) => qc.setQueryData(keys.settings, view),
  });
}

/* ---------- Claude (M7) ---------- */

export function useSaveAi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AiSettingsInput) => put('/api/settings/ai', input, SettingsView),
    onSuccess: (view) => qc.setQueryData(keys.settings, view),
  });
}

export function useClearAi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => del('/api/settings/ai', SettingsView),
    onSuccess: (view) => qc.setQueryData(keys.settings, view),
  });
}

export function useTestAi() {
  return useMutation({ mutationFn: () => post('/api/ai/test', undefined, AiTest) });
}

const ACTIVE_AI = new Set(['queued', 'running']);

/** Claude jobs of a book; polls while one runs and refreshes the book, selection and preflight when it settles. */
export function useAiJobs(id: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: keys.aiJobs(id ?? ''),
    queryFn: ({ signal }) => get(`/api/books/${encodeURIComponent(id ?? '')}/ai/jobs`, z.array(AiJob), signal),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data?.some((j) => ACTIVE_AI.has(j.status)) ? 1000 : false),
  });
  const active = query.data?.filter((j) => ACTIVE_AI.has(j.status)).length ?? 0;
  const prev = useRef(active);
  useEffect(() => {
    if (prev.current > 0 && active === 0 && id) {
      void Promise.all([qc.invalidateQueries({ queryKey: keys.book(id) }), qc.invalidateQueries({ queryKey: keys.selection(id) }), qc.invalidateQueries({ queryKey: keys.preflight(id) })]);
    }
    prev.current = active;
  }, [active, id, qc]);
  return query;
}

export function useStartAiJob(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, overwrite }: { kind: AiJobKind; overwrite?: boolean }) => post(`/api/books/${encodeURIComponent(id)}/ai/${kind}`, { overwrite: overwrite ?? false }, AiJob),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.aiJobs(id) });
    },
  });
}

/** Undoes Claude's pick for one burst; the selection is refetched. */
export function useRevertBurst(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assetId: string) => post(`/api/books/${encodeURIComponent(id)}/ai/bursts/revert`, { assetId }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.selection(id) });
    },
  });
}

/* ---------- Notifications (M7) ---------- */

export function useSaveNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NotificationSettingsInput) => put('/api/settings/notifications', input, SettingsView),
    onSuccess: (view) => qc.setQueryData(keys.settings, view),
  });
}

export function useClearNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => del('/api/settings/notifications', SettingsView),
    onSuccess: (view) => qc.setQueryData(keys.settings, view),
  });
}

/** Sends a test message through the stored target, or the typed one when given. */
export function useTestNotifications() {
  return useMutation({
    mutationFn: (input?: NotificationSettingsInput) => post('/api/notifications/test', input ?? {}, NotificationTest),
  });
}

export function useAlbums(enabled = true) {
  return useQuery({
    queryKey: keys.albums,
    queryFn: ({ signal }) => get('/api/immich/albums', AlbumList, signal),
    staleTime: 60_000,
    enabled,
  });
}

export function usePeople(enabled = true) {
  return useQuery({
    queryKey: keys.people,
    queryFn: ({ signal }) => get('/api/immich/people', PeopleResponse, signal),
    staleTime: 60_000,
    enabled,
  });
}

/** Trip suggestions for a YYYY-MM-DD range; the server scans the timeline month by month. */
export function useTrips(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: keys.trips(from, to),
    queryFn: ({ signal }) => get(`/api/immich/trips?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, TripsResponse, signal),
    staleTime: 10 * 60_000,
    enabled: enabled && Boolean(from && to),
  });
}

export function usePlaces(name: string, enabled = true) {
  const q = name.trim();
  return useQuery({
    queryKey: keys.places(q),
    queryFn: ({ signal }) => get(`/api/immich/places?name=${encodeURIComponent(q)}`, z.array(PlaceHit), signal),
    staleTime: 10 * 60_000,
    enabled: enabled && q.length > 1,
  });
}

export function useSmartPreview(query: string, enabled = true) {
  const q = query.trim();
  return useQuery({
    queryKey: keys.smart(q),
    queryFn: ({ signal }) => get(`/api/immich/smart?q=${encodeURIComponent(q)}&size=24`, SmartPreview, signal),
    staleTime: 5 * 60_000,
    enabled: enabled && q.length > 1,
  });
}

/* ---------- Books ---------- */

export function useBooks() {
  return useQuery({
    queryKey: keys.books,
    queryFn: ({ signal }) => get('/api/books', BookList, signal),
  });
}

export function useBook(id: string | undefined) {
  return useQuery({
    queryKey: keys.book(id ?? ''),
    queryFn: ({ signal }) => get(`/api/books/${encodeURIComponent(id ?? '')}`, Book, signal),
    enabled: Boolean(id),
  });
}

/** Sources as the wizard builds them: schema defaults (places, limit, includeUngeotagged) may be left out. */
export type SourceInput =
  | { kind: 'album'; albumIds: string[] }
  | { kind: 'trip'; takenAfter: string; takenBefore: string; places?: Array<{ name: string; bbox: [number, number, number, number] }>; includeUngeotagged?: boolean }
  | { kind: 'people'; personIds: string[] }
  | { kind: 'smart'; query: string; limit?: number }
  | { kind: 'pet'; name: string; query: string; exampleAssetIds?: string[]; limit?: number }
  | { kind: 'favorites' };

export interface CreateBookInput {
  title: string;
  formatId: string;
  themeId: string;
  rules?: Partial<Omit<SelectionRules, 'sources'>> & { sources: Array<SourceInput | SelectionSource> };
}

export function useCreateBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBookInput) => post('/api/books', input, Book),
    onSuccess: async (book) => {
      qc.setQueryData(keys.book(book.id), book);
      await qc.invalidateQueries({ queryKey: keys.books, exact: true });
    },
  });
}

export function useDeleteBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/api/books/${encodeURIComponent(id)}`),
    onSuccess: async (_data, id) => {
      qc.removeQueries({ queryKey: keys.book(id) });
      await qc.invalidateQueries({ queryKey: keys.books, exact: true });
    },
  });
}

/* ---------- Photos, layout, saving ---------- */

export function useBookAssets(id: string | undefined) {
  return useQuery({
    queryKey: keys.bookAssets(id ?? ''),
    queryFn: ({ signal }) => get(`/api/books/${encodeURIComponent(id ?? '')}/assets`, z.array(BookAsset), signal),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  });
}

export const LayoutResponse = z.object({ book: Book, warnings: z.array(z.string()), photoCount: z.number().int().nonnegative() });
export type LayoutResponse = z.infer<typeof LayoutResponse>;

/** Gathers photos from Immich (or reuses the stored list) and replaces the book's pages. */
export function useLayoutBook(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { refetch?: boolean } = {}) => post(`/api/books/${encodeURIComponent(id)}/layout`, input, LayoutResponse),
    onSuccess: async (res) => {
      qc.setQueryData(keys.book(id), res.book);
      await Promise.all([qc.invalidateQueries({ queryKey: keys.bookAssets(id) }), qc.invalidateQueries({ queryKey: keys.books, exact: true })]);
    },
  });
}

/** PUT the whole book document (the editor autosaves pages through this). */
export function useSaveBook(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (book: Book) => put(`/api/books/${encodeURIComponent(id)}`, book, Book),
    onSuccess: async (book) => {
      qc.setQueryData(keys.book(id), book);
      await Promise.all([qc.invalidateQueries({ queryKey: keys.books, exact: true }), qc.invalidateQueries({ queryKey: keys.preflight(id) })]);
    },
    // 409: the copy this save was built on is older than the server's (another tab, a Claude job).
    // Refetch so the page shows the current document; the caller reports the error and the user applies the change again.
    onError: async (err) => {
      if (isApiError(err) && err.status === 409) await qc.invalidateQueries({ queryKey: keys.book(id), exact: true });
    },
  });
}

/* ---------- Selection (M2) ---------- */

const ACTIVE_RUN = new Set(['queued', 'running']);

export function isActiveRun(run: SelectionRun | undefined): boolean {
  return Boolean(run && ACTIVE_RUN.has(run.status));
}

/** Candidates, summary and the latest run; polls while a run is queued or running. */
export function useSelection(id: string | undefined) {
  return useQuery({
    queryKey: keys.selection(id ?? ''),
    queryFn: ({ signal }) => get(`/api/books/${encodeURIComponent(id ?? '')}/selection`, SelectionView, signal),
    enabled: Boolean(id),
    refetchInterval: (query) => (isActiveRun(query.state.data?.run) ? 700 : false),
  });
}

export interface StartSelectionInput {
  refetch?: boolean;
  rules?: SelectionRules;
}

/** Queues a selection run (optionally saving new rules first). The selection query then polls it. */
export function useStartSelection(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StartSelectionInput = {}) => post(`/api/books/${encodeURIComponent(id)}/selection/runs`, input, SelectionRun),
    onSuccess: async (run, input) => {
      qc.setQueryData<SelectionView>(keys.selection(id), (prev) => ({ candidates: prev?.candidates ?? [], chapters: prev?.chapters ?? [], ...(prev?.summary ? { summary: prev.summary } : {}), run }));
      const tasks: Promise<unknown>[] = [qc.invalidateQueries({ queryKey: keys.selection(id) })];
      if (input.rules) tasks.push(qc.invalidateQueries({ queryKey: keys.book(id) }));
      if (input.refetch) tasks.push(qc.invalidateQueries({ queryKey: keys.bookAssets(id) }));
      await Promise.all(tasks);
    },
  });
}

/** user-in / user-out / auto for one or more photos; replaces the cached selection with the server's answer. */
export function useSetDecisions(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (decisions: Array<{ assetId: string; decision: DecisionChoice }>) =>
      put(`/api/books/${encodeURIComponent(id)}/selection/decisions`, { decisions }, SelectionView),
    onSuccess: async (view) => {
      qc.setQueryData(keys.selection(id), view);
      await qc.invalidateQueries({ queryKey: keys.books, exact: true });
    },
  });
}

/* ---------- Renders ---------- */

const ACTIVE_RENDER = new Set(['queued', 'running']);

/** Renders of a book; polls while one is queued or running. */
export function useRenders(id: string | undefined) {
  return useQuery({
    queryKey: keys.renders(id ?? ''),
    queryFn: ({ signal }) => get(`/api/books/${encodeURIComponent(id ?? '')}/renders`, z.array(RenderJob), signal),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.some((r) => ACTIVE_RENDER.has(r.status)) ? 1000 : false),
  });
}

/** Re-fetches preflight whenever the set of active renders settles (a job just finished). */
export function useInvalidateOnRenderSettle(id: string, renders: RenderJob[] | undefined): void {
  const qc = useQueryClient();
  const active = renders?.filter((r) => ACTIVE_RENDER.has(r.status)).length ?? 0;
  const prev = useRef(active);
  useEffect(() => {
    if (prev.current > 0 && active === 0) void qc.invalidateQueries({ queryKey: keys.preflight(id) });
    prev.current = active;
  }, [active, id, qc]);
}

export function useCreateRender(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: RenderKind) => post(`/api/books/${encodeURIComponent(id)}/renders`, { kind }, RenderJob),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: keys.renders(id) }), qc.invalidateQueries({ queryKey: keys.preflight(id) })]);
    },
  });
}

export function useDeleteRender(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (renderId: string) => del(`/api/books/${encodeURIComponent(id)}/renders/${encodeURIComponent(renderId)}`),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: keys.renders(id) }), qc.invalidateQueries({ queryKey: keys.book(id) }), qc.invalidateQueries({ queryKey: keys.preflight(id) })]);
    },
  });
}

/* ---------- Print readiness and sharing (M4) ---------- */

/** Preflight depends on the book, its assets and its renders; the card re-fetches when any of those change. */
export function usePreflight(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.preflight(id ?? ''),
    queryFn: ({ signal }) => get(`/api/books/${encodeURIComponent(id ?? '')}/preflight`, Preflight, signal),
    enabled: Boolean(id) && enabled,
    staleTime: 5_000,
  });
}

export function useShares(id: string | undefined) {
  return useQuery({
    queryKey: keys.shares(id ?? ''),
    queryFn: ({ signal }) => get(`/api/books/${encodeURIComponent(id ?? '')}/shares`, z.array(ShareView), signal),
    enabled: Boolean(id),
  });
}

export function useCreateShare(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateShareInput) => post(`/api/books/${encodeURIComponent(id)}/shares`, input, ShareView),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.shares(id) });
    },
  });
}

export function useUpdateShare(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, ...input }: UpdateShareInput & { shareId: string }) =>
      put(`/api/books/${encodeURIComponent(id)}/shares/${encodeURIComponent(shareId)}`, input, ShareView),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.shares(id) });
    },
  });
}

export function useRevokeShare(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) => del(`/api/books/${encodeURIComponent(id)}/shares/${encodeURIComponent(shareId)}`, ShareView),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.shares(id) });
    },
  });
}

/* ---------- Lulu (M5) ---------- */

/** Test a typed pair (not saved), or the stored pair of the active environment when called without input. */
export function useTestLulu() {
  return useMutation({
    mutationFn: (input?: LuluConnectionInput) => post('/api/lulu/test', input, LuluStatus),
  });
}

export function useSaveLulu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LuluConnectionInput) => put('/api/settings/lulu', input, SettingsView),
    onSuccess: (view) => qc.setQueryData(keys.settings, view),
  });
}

export function useClearLulu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (env: LuluEnv) => del(`/api/settings/lulu?env=${env}`, SettingsView),
    onSuccess: (view) => qc.setQueryData(keys.settings, view),
  });
}

export function useSetLuluSandbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sandbox: boolean) => put('/api/settings/lulu/sandbox', { sandbox }, SettingsView),
    onSuccess: (view) => qc.setQueryData(keys.settings, view),
  });
}

/** Fetches a throwaway export through the public URL, as Lulu would. */
export function useReachability() {
  return useMutation({
    mutationFn: () => post('/api/lulu/reachability', undefined, ReachabilityReport),
  });
}

/* ---------- Lulu webhooks and job list (M7) ---------- */

export function useLuluWebhook(enabled = true) {
  return useQuery({
    queryKey: ['lulu', 'webhook'] as const,
    queryFn: ({ signal }) => get('/api/lulu/webhook', LuluWebhookView.nullable(), signal),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useSubscribeLuluWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post('/api/lulu/webhook', undefined, LuluWebhookView),
    onSuccess: (hook) => qc.setQueryData(['lulu', 'webhook'], hook),
  });
}

export function useUnsubscribeLuluWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => del('/api/lulu/webhook'),
    onSuccess: () => qc.setQueryData(['lulu', 'webhook'], null),
  });
}

export function useTestLuluWebhook() {
  return useMutation({ mutationFn: () => post('/api/lulu/webhook/test') });
}

/** Print jobs on the Lulu account (newest first), with the local order when one tracks them. */
export function useLuluPrintJobs(enabled = true) {
  return useQuery({
    queryKey: ['lulu', 'print-jobs'] as const,
    queryFn: ({ signal }) => get('/api/lulu/print-jobs', z.array(LuluRemoteJob), signal),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useImportLuluJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, bookId }: { jobId: string; bookId?: string }) => post(`/api/lulu/print-jobs/${encodeURIComponent(jobId)}/import`, bookId ? { bookId } : {}, OrderView),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ['lulu', 'print-jobs'] }), qc.invalidateQueries({ queryKey: keys.allOrders }), qc.invalidateQueries({ queryKey: keys.books })]);
    },
  });
}

/* ---------- Orders (M5) ---------- */

const MOVING_ORDER = new Set(['draft', 'validating']);

export function useAllOrders() {
  return useQuery({
    queryKey: keys.allOrders,
    queryFn: ({ signal }) => get('/api/orders', z.array(OrderView), signal),
    refetchInterval: (query) => (query.state.data?.some((o) => MOVING_ORDER.has(o.status)) ? 1500 : false),
  });
}

export function useOrders(id: string | undefined) {
  return useQuery({
    queryKey: keys.orders(id ?? ''),
    queryFn: ({ signal }) => get(`/api/books/${encodeURIComponent(id ?? '')}/orders`, z.array(OrderView), signal),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.some((o) => MOVING_ORDER.has(o.status)) ? 1500 : false),
  });
}

/** One order; polls while Lulu is validating the files. */
export function useOrder(id: string | undefined, oid: string | undefined) {
  return useQuery({
    queryKey: keys.order(id ?? '', oid ?? ''),
    queryFn: ({ signal }) => get(`/api/books/${encodeURIComponent(id ?? '')}/orders/${encodeURIComponent(oid ?? '')}`, OrderView, signal),
    enabled: Boolean(id && oid),
    refetchInterval: (query) => (query.state.data && MOVING_ORDER.has(query.state.data.status) ? 1500 : false),
  });
}

function useOrderMutation<TInput>(id: string, run: (input: TInput) => Promise<OrderView>) {
  const qc = useQueryClient();
  return useMutation<OrderView, Error, TInput>({
    mutationFn: run,
    onSuccess: async (order) => {
      qc.setQueryData(keys.order(id, order.id), order);
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.orders(id), exact: true }),
        qc.invalidateQueries({ queryKey: keys.allOrders }),
        qc.invalidateQueries({ queryKey: keys.book(id) }),
        qc.invalidateQueries({ queryKey: keys.settings }),
      ]);
    },
  });
}

/** Validates the PDFs with Lulu and quotes the price; the order then polls until `quoted` or `rejected`. */
export function usePrepareOrder(id: string) {
  return useOrderMutation(id, (input: PrepareOrderInput) => post(`/api/books/${encodeURIComponent(id)}/orders`, input, OrderView));
}

export function useSubmitOrder(id: string) {
  return useOrderMutation(id, (oid: string) => post(`/api/books/${encodeURIComponent(id)}/orders/${encodeURIComponent(oid)}/submit`, undefined, OrderView));
}

export function useRefreshOrder(id: string) {
  return useOrderMutation(id, (oid: string) => post(`/api/books/${encodeURIComponent(id)}/orders/${encodeURIComponent(oid)}/refresh`, undefined, OrderView));
}

export function useCancelOrder(id: string) {
  return useOrderMutation(id, (oid: string) => post(`/api/books/${encodeURIComponent(id)}/orders/${encodeURIComponent(oid)}/cancel`, undefined, OrderView));
}
