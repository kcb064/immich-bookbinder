import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Book, BookAsset, ImmichStatus, RenderJob, SelectionRun, SelectionView, SettingsView } from '@bookbinder/shared';
import type { DecisionChoice, ImmichConnectionInput, RenderKind, SelectionRules } from '@bookbinder/shared';
import { del, get, post, put } from './api.ts';

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
  /** The list. Invalidate with `exact: true`: the per-book keys below share the prefix. */
  books: ['books'] as const,
  book: (id: string) => ['books', id] as const,
  bookAssets: (id: string) => ['books', id, 'assets'] as const,
  renders: (id: string) => ['books', id, 'renders'] as const,
  selection: (id: string) => ['books', id, 'selection'] as const,
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

export interface CreateBookInput {
  title: string;
  formatId: string;
  themeId: string;
  rules?: Partial<SelectionRules> & Pick<SelectionRules, 'sources'>;
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
      await qc.invalidateQueries({ queryKey: keys.books, exact: true });
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
      qc.setQueryData<SelectionView>(keys.selection(id), (prev) => ({ candidates: prev?.candidates ?? [], ...(prev?.summary ? { summary: prev.summary } : {}), run }));
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

export function useCreateRender(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: RenderKind) => post(`/api/books/${encodeURIComponent(id)}/renders`, { kind }, RenderJob),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.renders(id) });
    },
  });
}

export function useDeleteRender(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (renderId: string) => del(`/api/books/${encodeURIComponent(id)}/renders/${encodeURIComponent(renderId)}`),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: keys.renders(id) }), qc.invalidateQueries({ queryKey: keys.book(id) })]);
    },
  });
}
