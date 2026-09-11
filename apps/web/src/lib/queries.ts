import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Book, ImmichStatus, SettingsView } from '@bookbinder/shared';
import type { ImmichConnectionInput, SelectionRules } from '@bookbinder/shared';
import { del, get, post, put } from './api.ts';

/* ---------- Schemas for endpoints without a shared type ---------- */

export const Me = z.object({
  authenticated: z.boolean(),
  /** 'session' (password login), 'cf-access' (proxy header), or null when signed out. */
  via: z.string().nullable().optional(),
});
export type Me = z.infer<typeof Me>;

/** Subset of Immich's AlbumResponseDto that the wizard uses. */
export const AlbumSummary = z.looseObject({
  id: z.string(),
  albumName: z.string(),
  assetCount: z.number().int().nonnegative().default(0),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  albumThumbnailAssetId: z.string().nullish(),
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
  books: ['books'] as const,
  book: (id: string) => ['books', id] as const,
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
      await qc.invalidateQueries({ queryKey: keys.books });
    },
  });
}

export function useDeleteBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/api/books/${encodeURIComponent(id)}`),
    onSuccess: async (_data, id) => {
      qc.removeQueries({ queryKey: keys.book(id) });
      await qc.invalidateQueries({ queryKey: keys.books });
    },
  });
}
