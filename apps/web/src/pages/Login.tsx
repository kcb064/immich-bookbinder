import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { Button, Field, PasswordInput } from '../components/ui.tsx';
import { useLogin, useMe } from '../lib/queries.ts';
import { errorMessage, isApiError } from '../lib/api.ts';

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export function LoginPage() {
  const me = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  if (me.isSuccess && me.data.authenticated) {
    return <Navigate to={next} replace />;
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!password) return;
    login.mutate(password, {
      onSuccess: () => navigate(next, { replace: true }),
    });
  };

  const error = login.isError
    ? isApiError(login.error) && (login.error.status === 401 || login.error.status === 403)
      ? 'That password is not right.'
      : errorMessage(login.error)
    : touched && !password
      ? 'Enter your password.'
      : undefined;

  return (
    <div className="login">
      <div className="card login__card">
        <div className="login__head">
          <div className="row">
            <span className="brand__mark">
              <Icon name="book" />
            </span>
            <span className="brand__name">Bookbinder</span>
          </div>
          <h1 className="login__title">Sign in</h1>
          <p className="muted" style={{ margin: 0 }}>
            Enter the admin password set in <span className="mono">ADMIN_PASSWORD</span>.
          </p>
        </div>
        <form className="login__form" onSubmit={onSubmit} noValidate>
          <Field label="Password" error={error}>
            {({ id, describedBy, invalid }) => (
              <PasswordInput
                id={id}
                name="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (login.isError) login.reset();
                }}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                disabled={login.isPending}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={login.isPending} disabled={me.isPending}>
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
