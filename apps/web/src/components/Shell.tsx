import type { ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';
import { Chip, Dot, Skeleton } from './ui.tsx';
import { useImmichStatus, useLogout, useMe, useSettings } from '../lib/queries.ts';
import { compactUrl, formatNumber } from '../lib/format.ts';
import { errorMessage } from '../lib/api.ts';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
  soon?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Books', icon: 'book', end: true },
  { to: '/new', label: 'New book', icon: 'plus' },
  { to: '/people', label: 'People & pets', icon: 'people', soon: true },
  { to: '/orders', label: 'Orders', icon: 'orders', soon: true },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export function ImmichCard() {
  const settings = useSettings();
  const configured = Boolean(settings.data?.immich.url && settings.data.immich.apiKeySet);
  const status = useImmichStatus(settings.isSuccess && configured);

  if (settings.isPending || (configured && status.isPending)) {
    return (
      <div className="card immich-card" aria-busy="true" aria-label="Checking Immich connection">
        <div className="immich-card__title">
          <Dot tone="neutral" />
          <span>Checking Immich…</span>
        </div>
        <Skeleton height={12} width="80%" />
        <Skeleton height={12} width="60%" />
      </div>
    );
  }

  if (settings.isError) {
    return (
      <Link to="/settings" className="card immich-card">
        <div className="immich-card__title">
          <Dot tone="red" />
          <span>Settings unavailable</span>
        </div>
        <div className="immich-card__line">{errorMessage(settings.error)}</div>
      </Link>
    );
  }

  if (!configured) {
    return (
      <Link to="/settings" className="card immich-card">
        <div className="immich-card__title">
          <Dot tone="amber" />
          <span>Immich not configured</span>
        </div>
        <div className="immich-card__line">Add your server URL and API key</div>
      </Link>
    );
  }

  const s = status.data;
  if (status.isError || !s || !s.connected) {
    const msg = s?.error ?? (status.isError ? errorMessage(status.error) : 'Connection failed');
    return (
      <Link to="/settings" className="card immich-card" title={msg}>
        <div className="immich-card__title">
          <Dot tone="red" />
          <span>Immich unreachable</span>
        </div>
        <div className="immich-card__line">{compactUrl(settings.data?.immich.url)}</div>
        <div className="immich-card__line">{msg}</div>
      </Link>
    );
  }

  const failing = s.permissions.filter((p) => !p.ok).length;
  return (
    <Link to="/settings" className="card immich-card">
      <div className="immich-card__title">
        <Dot tone={failing > 0 ? 'amber' : 'green'} />
        <span>Immich connected</span>
      </div>
      <div className="immich-card__line">
        {compactUrl(s.url ?? settings.data?.immich.url)}
        {s.serverVersion ? ` · v${s.serverVersion}` : ''}
      </div>
      <div className="immich-card__line">
        {s.photos !== undefined ? `${formatNumber(s.photos)} photos` : 'Photo count unavailable'}
        {s.people !== undefined ? ` · ${formatNumber(s.people)} people` : ''}
      </div>
      {failing > 0 ? <div className="immich-card__line">{failing} permission{failing === 1 ? '' : 's'} missing</div> : null}
    </Link>
  );
}

function Sidebar() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const canLogout = me.data?.via === 'session';

  return (
    <aside className="side" aria-label="Primary">
      <Link to="/" className="brand" aria-label="Bookbinder home">
        <span className="brand__mark">
          <Icon name="book" />
        </span>
        <span className="brand__name">Bookbinder</span>
      </Link>
      <nav aria-label="Main" style={{ display: 'contents' }}>
        {NAV.map((item) =>
          item.soon ? (
            <span key={item.to} className="nav nav--disabled" aria-disabled="true" title={`${item.label} is coming soon`}>
              <Icon name={item.icon} />
              <span className="nav__label">{item.label}</span>
              <Chip>soon</Chip>
            </span>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? false}
              className={({ isActive }) => `nav${isActive ? ' nav--on' : ''}`}
              title={item.label}
            >
              <Icon name={item.icon} />
              <span className="nav__label">{item.label}</span>
            </NavLink>
          ),
        )}
      </nav>
      <div className="side__spacer" />
      <div className="side__foot">
        <ImmichCard />
        {canLogout ? (
          <button
            type="button"
            className="signout"
            onClick={() => {
              logout.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) });
            }}
            disabled={logout.isPending}
            title="Sign out"
          >
            <Icon name="logout" size={16} />
            <span>Sign out</span>
          </button>
        ) : null}
      </div>
    </aside>
  );
}

/** Renders its child routes only with a session; redirects to /login otherwise. */
export function RequireAuth() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) {
    return (
      <div className="login" aria-busy="true">
        <div className="muted">Loading…</div>
      </div>
    );
  }
  if (me.isSuccess && !me.data.authenticated) {
    const next = location.pathname + location.search;
    return <Navigate to={next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login'} replace />;
  }
  if (me.isError) {
    return (
      <div className="login">
        <div className="card login__card">
          <h1 className="login__title">Server unavailable</h1>
          <p className="muted" style={{ margin: 0 }}>
            {errorMessage(me.error)}. Make sure the Bookbinder server is running, then reload.
          </p>
        </div>
      </div>
    );
  }

  return <Outlet />;
}

/** Authenticated layout: sidebar plus main column. */
export function Shell() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) {
    return (
      <div className="login" aria-busy="true">
        <div className="muted">Loading…</div>
      </div>
    );
  }
  if (me.isSuccess && !me.data.authenticated) {
    const next = location.pathname + location.search;
    return <Navigate to={next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login'} replace />;
  }
  if (me.isError) {
    return (
      <div className="login">
        <div className="card login__card">
          <h1 className="login__title">Server unavailable</h1>
          <p className="muted" style={{ margin: 0 }}>
            {errorMessage(me.error)}. Make sure the Bookbinder server is running, then reload.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <Sidebar />
      <main className="main" id="main">
        <Outlet />
      </main>
    </div>
  );
}

/** Sticky page header: title on the left, actions on the right. */
export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="top">
      <h1 className="h1">{title}</h1>
      {children ? <div className="top__actions">{children}</div> : null}
    </header>
  );
}
