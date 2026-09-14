import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { RequireAuth, Shell } from './components/Shell.tsx';
import { LoginPage } from './pages/Login.tsx';
import { DashboardPage } from './pages/Dashboard.tsx';
import { BookDetailPage } from './pages/BookDetail.tsx';
import { EditorPage } from './pages/Editor.tsx';
import { NewBookPage } from './pages/NewBook.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { NotFoundPage } from './pages/NotFound.tsx';
import { isApiError } from './lib/api.ts';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Never retry auth/permission/not-found failures; retry transient ones once.
        if (isApiError(error) && (error.status === 401 || error.status === 403 || error.status === 404 || error.status === 400)) return false;
        return failureCount < 1;
      },
    },
  },
});

export const router = createBrowserRouter([
  { path: '/login', Component: LoginPage },
  {
    // The editor takes the whole viewport (no sidebar) but still needs a session.
    path: '/books/:id/edit',
    Component: RequireAuth,
    children: [{ index: true, Component: EditorPage }],
  },
  {
    path: '/',
    Component: Shell,
    children: [
      { index: true, Component: DashboardPage },
      { path: 'new', Component: NewBookPage },
      { path: 'books/:id', Component: BookDetailPage },
      { path: 'settings', Component: SettingsPage },
      { path: '*', Component: NotFoundPage },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
