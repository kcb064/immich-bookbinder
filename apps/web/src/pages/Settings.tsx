import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { REQUIRED_IMMICH_PERMISSIONS, SUPPORTED_IMMICH_VERSION } from '@bookbinder/shared';
import type { ImmichConnectionInput, ImmichStatus, LuluEnv } from '@bookbinder/shared';
import { PageHeader } from '../components/Shell.tsx';
import { PetsSection } from '../components/PetsSection.tsx';
import { NotificationsSection } from '../components/NotificationsSection.tsx';
import { AiSection } from '../components/AiSection.tsx';
import { LuluWebhookBlock } from '../components/LuluWebhook.tsx';
import { Icon } from '../components/Icon.tsx';
import { Button, Chip, Dot, Field, Note, PasswordInput, Skeleton, TextInput } from '../components/ui.tsx';
import {
  useClearImmich,
  useClearLulu,
  useImmichStatus,
  useReachability,
  useSaveImmich,
  useSaveLulu,
  useSavePublicUrl,
  useSetLuluSandbox,
  useSettings,
  useTestImmich,
  useTestLulu,
} from '../lib/queries.ts';
import { errorMessage } from '../lib/api.ts';
import { compactUrl, formatNumber } from '../lib/format.ts';

const IMMICH_SETUP_DOC = 'https://github.com/kcb064/immich-bookbinder/blob/main/docs/immich-setup.md';
const LULU_SETUP_DOC = 'https://github.com/kcb064/immich-bookbinder/blob/main/docs/lulu-setup.md';
const DEPLOY_DOC = 'https://github.com/kcb064/immich-bookbinder/blob/main/docs/deploy-dockge.md';

function normalizeUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u.replace(/\/api$/i, '');
}

function isValidUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function versionTone(server: string | undefined): 'green' | 'amber' | 'neutral' {
  if (!server) return 'neutral';
  const [sMaj, sMin] = server.split('.');
  const [bMaj, bMin] = SUPPORTED_IMMICH_VERSION.split('.');
  if (sMaj !== bMaj) return 'amber';
  if (sMin !== bMin) return 'amber';
  return 'green';
}

function PermissionList({ probes }: { probes: ImmichStatus['permissions'] }) {
  const byName = new Map(probes.map((p) => [p.permission, p]));
  return (
    <ul className="perms">
      {REQUIRED_IMMICH_PERMISSIONS.map((perm) => {
        const probe = byName.get(perm);
        const state = probe ? (probe.ok ? 'ok' : 'fail') : 'unknown';
        const label = state === 'ok' ? 'granted' : state === 'fail' ? 'missing' : 'not probed';
        return (
          <li key={perm} className={`perm perm--${state}`} title={probe?.detail ?? label}>
            <span className={`perm__icon perm__icon--${state}`}>
              <Icon name={state === 'ok' ? 'check' : state === 'fail' ? 'x' : 'minus'} size={13} strokeWidth={2.2} title={label} />
            </span>
            <span className="perm__name">{perm}</span>
          </li>
        );
      })}
    </ul>
  );
}

function StatusPanel({ status, pending, error }: { status: ImmichStatus | undefined; pending: boolean; error: unknown }) {
  if (pending) {
    return (
      <div className="status" aria-busy="true">
        <div className="status__head">
          <Dot tone="neutral" />
          Testing connection…
        </div>
        <Skeleton height={56} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="status" role="alert">
        <div className="status__head">
          <Dot tone="red" />
          Test failed
        </div>
        <div className="muted">{errorMessage(error)}</div>
      </div>
    );
  }
  if (!status) return null;

  if (!status.connected) {
    return (
      <div className="status" role="alert">
        <div className="status__head">
          <Dot tone="red" />
          Could not connect{status.url ? ` to ${compactUrl(status.url)}` : ''}
        </div>
        <div className="muted" style={{ lineHeight: 1.5 }}>
          {status.error ?? 'Immich did not answer. Check the URL, that the server is reachable from Bookbinder, and the API key.'}
        </div>
        {status.permissions.length > 0 ? <PermissionList probes={status.permissions} /> : null}
      </div>
    );
  }

  const failing = status.permissions.filter((p) => !p.ok);
  const vTone = versionTone(status.serverVersion);
  return (
    <div className="status" role="status">
      <div className="status__head">
        <Dot tone={failing.length > 0 ? 'amber' : 'green'} />
        Connected{status.url ? ` to ${compactUrl(status.url)}` : ''}
        {status.serverVersion ? (
          <Chip tone={vTone === 'neutral' ? 'neutral' : vTone} className="mono">
            v{status.serverVersion}
          </Chip>
        ) : null}
      </div>
      {vTone === 'amber' ? (
        <Note tone="amber">
          This app was built against Immich v{SUPPORTED_IMMICH_VERSION}. Other versions usually work, but some endpoints may differ.
        </Note>
      ) : null}
      <div className="status__grid">
        <div className="stat">
          <span className="stat__value">{status.user?.name ?? '—'}</span>
          <span className="stat__label">{status.user?.email ?? 'API key owner'}</span>
        </div>
        <div className="stat">
          <span className="stat__value mono">{formatNumber(status.photos)}</span>
          <span className="stat__label">photos</span>
        </div>
        <div className="stat">
          <span className="stat__value mono">{formatNumber(status.albums)}</span>
          <span className="stat__label">albums</span>
        </div>
        <div className="stat">
          <span className="stat__value mono">{formatNumber(status.people)}</span>
          <span className="stat__label">people</span>
        </div>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        <div className="row row--between">
          <div className="label">API key permissions</div>
          <span className="muted small">
            Built against v{SUPPORTED_IMMICH_VERSION} ·{' '}
            <a href={IMMICH_SETUP_DOC} target="_blank" rel="noreferrer">
              Setup guide <Icon name="external" size={12} />
            </a>
          </span>
        </div>
        {failing.length > 0 ? (
          <Note tone="amber">
            {failing.length} required permission{failing.length === 1 ? ' is' : 's are'} missing. Edit the API key in Immich (Account
            settings → API keys) and grant the ones marked red.
          </Note>
        ) : null}
        <PermissionList probes={status.permissions} />
      </div>
    </div>
  );
}

function ImmichSection() {
  const settings = useSettings();
  const saved = settings.data?.immich;
  const configured = Boolean(saved?.url && saved?.apiKeySet);
  const cached = useImmichStatus(settings.isSuccess && configured);
  const test = useTestImmich();
  const save = useSaveImmich();
  const clear = useClearImmich();

  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [dirty, setDirty] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (saved?.url && !dirty) setUrl(saved.url);
  }, [saved?.url, dirty]);

  const normalized = normalizeUrl(url);
  const urlError = submitted && (!normalized || !isValidUrl(normalized)) ? 'Enter the Immich URL, e.g. http://immich_server:2283' : undefined;
  const keyError =
    submitted && !apiKey && !saved?.apiKeySet
      ? 'Paste an API key from Immich.'
      : submitted && apiKey && apiKey.length < 10
        ? 'That does not look like an Immich API key.'
        : undefined;

  const typedInput = (): ImmichConnectionInput | undefined => {
    if (!normalized || !isValidUrl(normalized)) return undefined;
    if (apiKey.length >= 10) return { url: normalized, apiKey };
    return undefined;
  };

  const onTest = () => {
    setSubmitted(true);
    setJustSaved(false);
    const input = typedInput();
    if (input) {
      test.mutate(input);
      return;
    }
    // No new key typed: test with saved credentials when the URL is unchanged.
    if (saved?.apiKeySet && normalized === saved.url) {
      test.mutate(undefined);
    }
  };

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const input = typedInput();
    if (!input) return;
    save.mutate(input, {
      onSuccess: () => {
        setApiKey('');
        setDirty(false);
        setJustSaved(true);
        test.reset();
      },
    });
  };

  const onClear = () => {
    if (!window.confirm('Remove the saved Immich URL and API key?')) return;
    clear.mutate(undefined, {
      onSuccess: () => {
        setUrl('');
        setApiKey('');
        setDirty(false);
        test.reset();
        setJustSaved(false);
      },
    });
  };

  // Show the ad-hoc test result when there is one, else the cached saved-connection status.
  const showing = test.data ?? test.error ? { status: test.data, error: test.error, pending: test.isPending } : configured
    ? { status: cached.data, error: cached.error, pending: cached.isPending }
    : { status: undefined, error: undefined, pending: test.isPending };

  const canSave = Boolean(typedInput()) && !save.isPending;
  const canTest = !test.isPending && (Boolean(typedInput()) || (configured && normalized === saved?.url));

  return (
    <section className="card section" aria-labelledby="immich-title">
      <div className="section__head">
        <div>
          <h2 className="section__title" id="immich-title">
            <Icon name="server" />
            Immich
            {settings.isSuccess ? (
              configured ? (
                <Chip tone="green" icon="check">
                  configured
                </Chip>
              ) : (
                <Chip tone="amber">not configured</Chip>
              )
            ) : null}
          </h2>
          <p className="section__desc">
            Bookbinder reads albums, people and photos through the Immich API with a read-only key. Create one in Immich under Account
            settings → API keys and grant the permissions listed below.{' '}
            <a href={IMMICH_SETUP_DOC} target="_blank" rel="noreferrer">
              Read the setup guide <Icon name="external" size={12} />
            </a>
          </p>
        </div>
      </div>

      <form className="stack" style={{ gap: 20 }} onSubmit={onSave} noValidate>
        <div className="form-grid">
          <Field label="Server URL" hint="Base URL without /api, as reachable from the Bookbinder server." error={urlError}>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="http://immich_server:2283"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setDirty(true);
                  setJustSaved(false);
                }}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                disabled={settings.isPending}
              />
            )}
          </Field>
          <Field
            label="API key"
            hint={saved?.apiKeySet ? 'A key is saved. Paste a new one to replace it.' : 'Stored encrypted on the server; never shown again.'}
            error={keyError}
          >
            {({ id, describedBy, invalid }) => (
              <PasswordInput
                id={id}
                autoComplete="off"
                placeholder={saved?.apiKeySet ? '•••••••••••••••• (saved)' : 'Paste your Immich API key'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setDirty(true);
                  setJustSaved(false);
                }}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                disabled={settings.isPending}
              />
            )}
          </Field>
        </div>

        {save.isError ? (
          <Note tone="error" role="alert">
            Could not save: {errorMessage(save.error)}
          </Note>
        ) : null}
        {clear.isError ? (
          <Note tone="error" role="alert">
            Could not remove the connection: {errorMessage(clear.error)}
          </Note>
        ) : null}
        {justSaved ? (
          <Note tone="accent" icon="check" role="status">
            Saved. Re-testing the stored connection below.
          </Note>
        ) : null}

        <div className="actions">
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!canSave && submitted}>
            Save
          </Button>
          <Button icon="refresh" onClick={onTest} loading={test.isPending} disabled={!canTest && submitted}>
            Test connection
          </Button>
          {configured ? (
            <Button variant="danger" icon="x" onClick={onClear} loading={clear.isPending} style={{ marginLeft: 'auto' }}>
              Remove connection
            </Button>
          ) : null}
        </div>
      </form>

      <StatusPanel status={showing.status} pending={showing.pending} error={showing.error} />
    </section>
  );
}

function PublicUrlSection() {
  const settings = useSettings();
  const save = useSavePublicUrl();
  const reach = useReachability();
  const [value, setValue] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!dirty) setValue(settings.data?.publicUrl ?? '');
  }, [settings.data?.publicUrl, dirty]);

  const trimmed = value.trim().replace(/\/+$/, '');
  const invalid = trimmed.length > 0 && !isValidUrl(trimmed);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    save.mutate(trimmed, {
      onSuccess: () => {
        setDirty(false);
        setSaved(true);
      },
    });
  };

  return (
    <section className="card section" aria-labelledby="public-url-title">
      <div className="section__head">
        <div>
          <h2 className="section__title" id="public-url-title">
            <Icon name="link" />
            Public URL
          </h2>
          <p className="section__desc">
            Where people reach Bookbinder from outside your network. Used for the QR code on the colophon page, the web viewer link and the
            PDF links Lulu downloads print files from. Leave empty to skip the QR code (Lulu ordering then stays off).
          </p>
        </div>
      </div>
      <form className="stack" onSubmit={onSubmit} noValidate>
        <Field label="Public URL" error={invalid ? 'Enter a full URL starting with http:// or https://' : undefined}>
          {({ id, describedBy, invalid: inv }) => (
            <TextInput
              id={id}
              type="url"
              inputMode="url"
              placeholder="https://books.example.com"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setDirty(true);
                setSaved(false);
              }}
              aria-describedby={describedBy}
              aria-invalid={inv || undefined}
              disabled={settings.isPending}
            />
          )}
        </Field>
        {save.isError ? (
          <Note tone="error" role="alert">
            Could not save: {errorMessage(save.error)}
          </Note>
        ) : null}
        <div className="actions">
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty || invalid}>
            Save
          </Button>
          {saved ? (
            <span className="muted small row" role="status">
              <Icon name="check" size={14} /> Saved
            </span>
          ) : null}
          <Button
            icon="link"
            onClick={() => reach.mutate()}
            loading={reach.isPending}
            disabled={dirty || !settings.data?.publicUrl}
            title={dirty ? 'Save the URL first' : !settings.data?.publicUrl ? 'Save a public URL first' : 'Fetch a test PDF through the public URL, the way Lulu will'}
            style={{ marginLeft: 'auto' }}
          >
            Check reachability
          </Button>
        </div>
      </form>
      {reach.isError ? (
        <Note tone="error" role="alert">
          {errorMessage(reach.error)}
        </Note>
      ) : null}
      {reach.data ? (
        <div className="status" role={reach.data.ok ? 'status' : 'alert'}>
          <div className="status__head">
            <Dot tone={reach.data.ok ? 'green' : 'red'} />
            {reach.data.ok ? 'Reachable: the PDF came back intact' : 'Not reachable the way Lulu needs'}
            <span className="muted small mono" style={{ fontWeight: 400 }}>
              {reach.data.status ? `HTTP ${reach.data.status} · ` : ''}
              {reach.data.latencyMs} ms{reach.data.contentType ? ` · ${reach.data.contentType}` : ''}
            </span>
          </div>
          <div className="mono small muted" style={{ overflowWrap: 'anywhere' }}>
            {reach.data.url}
          </div>
          {reach.data.error ? <div>{reach.data.error}</div> : null}
          {reach.data.hint ? (
            <Note tone="amber">
              {reach.data.hint}{' '}
              <a href={DEPLOY_DOC} target="_blank" rel="noreferrer">
                Deployment guide <Icon name="external" size={12} />
              </a>
            </Note>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Lulu credentials: the sandbox switch picks the active environment; the form edits that environment's pair. */
function LuluSection() {
  const settings = useSettings();
  const lulu = settings.data?.lulu;
  const env: LuluEnv = lulu?.sandbox === false ? 'production' : 'sandbox';
  const keySet = env === 'sandbox' ? Boolean(lulu?.sandboxKeySet) : Boolean(lulu?.productionKeySet);
  const setSandbox = useSetLuluSandbox();
  const save = useSaveLulu();
  const clear = useClearLulu();
  const test = useTestLulu();

  const [clientKey, setClientKey] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const typed = clientKey.trim().length >= 8 && clientSecret.trim().length >= 8 ? { env, clientKey: clientKey.trim(), clientSecret: clientSecret.trim() } : undefined;
  const partial = Boolean(clientKey.trim() || clientSecret.trim()) && !typed;
  const keyError = submitted && !typed && !keySet ? 'Paste both the client key and the client secret from the Lulu developer portal.' : undefined;

  const reset = () => {
    setClientKey('');
    setClientSecret('');
    setSubmitted(false);
    setJustSaved(false);
    test.reset();
  };

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!typed) return;
    save.mutate(typed, {
      onSuccess: () => {
        reset();
        setJustSaved(true);
        test.mutate(undefined);
      },
    });
  };

  const onTest = () => {
    setSubmitted(true);
    setJustSaved(false);
    if (typed) test.mutate(typed);
    else if (keySet && !partial) test.mutate(undefined);
  };

  const onClear = () => {
    if (!window.confirm(`Remove the saved Lulu ${env} key and secret?`)) return;
    clear.mutate(env, { onSuccess: reset });
  };

  const onSwitch = (sandbox: boolean) => {
    reset();
    setSandbox.mutate(sandbox);
  };

  const canTest = !test.isPending && (Boolean(typed) || (keySet && !partial));
  const status = test.data;

  return (
    <section className="card section" aria-labelledby="lulu-title">
      <div className="section__head">
        <div>
          <h2 className="section__title" id="lulu-title">
            <Icon name="printer" />
            Lulu printing
            {settings.isSuccess ? (
              keySet ? (
                <Chip tone={env === 'production' ? 'amber' : 'green'} icon="check">
                  {env} configured
                </Chip>
              ) : (
                <Chip tone="neutral">{env}: not configured</Chip>
              )
            ) : null}
          </h2>
          <p className="section__desc">
            Order printed books through the Lulu Print API. Keys come from the Lulu developer portal (sandbox and production are separate
            accounts); the app validates the PDFs, quotes the price and creates the print job, and you pay on lulu.com.{' '}
            <a href={LULU_SETUP_DOC} target="_blank" rel="noreferrer">
              Read the setup guide <Icon name="external" size={12} />
            </a>
          </p>
        </div>
      </div>

      <label className="toggle">
        <input type="checkbox" className="visually-hidden" checked={env === 'sandbox'} onChange={(e) => onSwitch(e.target.checked)} disabled={setSandbox.isPending || settings.isPending} />
        <span className={`toggle__track${env === 'sandbox' ? ' toggle__track--on' : ''}`} aria-hidden="true">
          <span className="toggle__knob" />
        </span>
        <span>
          <strong>Sandbox</strong>{' '}
          <span className="muted">
            {env === 'sandbox' ? 'on: orders are validated and priced at api.sandbox.lulu.com, never printed or charged.' : 'off: orders go to api.lulu.com and cost real money once paid.'}
          </span>
        </span>
      </label>

      <form className="stack" style={{ gap: 20 }} onSubmit={onSave} noValidate>
        <div className="form-grid">
          <Field label={`Client key (${env})`} hint={keySet ? 'A key is saved. Paste a new pair to replace it.' : 'From your profile, API Keys, in the developer portal.'} error={keyError}>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                autoComplete="off"
                placeholder={keySet ? '•••••••••••••••• (saved)' : 'Client key'}
                value={clientKey}
                onChange={(e) => {
                  setClientKey(e.target.value);
                  setJustSaved(false);
                }}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                disabled={settings.isPending}
              />
            )}
          </Field>
          <Field label={`Client secret (${env})`} hint="Stored encrypted on the server; never shown again.">
            {({ id, describedBy }) => (
              <PasswordInput
                id={id}
                autoComplete="off"
                placeholder={keySet ? '•••••••••••••••• (saved)' : 'Client secret'}
                value={clientSecret}
                onChange={(e) => {
                  setClientSecret(e.target.value);
                  setJustSaved(false);
                }}
                aria-describedby={describedBy}
                disabled={settings.isPending}
              />
            )}
          </Field>
        </div>

        {save.isError ? (
          <Note tone="error" role="alert">
            Could not save: {errorMessage(save.error)}
          </Note>
        ) : null}
        {clear.isError ? (
          <Note tone="error" role="alert">
            Could not remove the credentials: {errorMessage(clear.error)}
          </Note>
        ) : null}
        {setSandbox.isError ? (
          <Note tone="error" role="alert">
            Could not switch environments: {errorMessage(setSandbox.error)}
          </Note>
        ) : null}
        {justSaved ? (
          <Note tone="accent" icon="check" role="status">
            Saved. Testing the stored {env} credentials below.
          </Note>
        ) : null}

        <div className="actions">
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!typed && submitted}>
            Save
          </Button>
          <Button icon="refresh" onClick={onTest} loading={test.isPending} disabled={!canTest && submitted}>
            Test credentials
          </Button>
          {keySet ? (
            <Button variant="danger" icon="x" onClick={onClear} loading={clear.isPending} style={{ marginLeft: 'auto' }}>
              Remove {env} credentials
            </Button>
          ) : null}
        </div>
      </form>

      {test.isPending ? (
        <div className="status" aria-busy="true">
          <div className="status__head">
            <Dot tone="neutral" />
            Requesting a token from Lulu…
          </div>
          <Skeleton height={24} />
        </div>
      ) : test.isError ? (
        <div className="status" role="alert">
          <div className="status__head">
            <Dot tone="red" />
            Test failed
          </div>
          <div className="muted">{errorMessage(test.error)}</div>
        </div>
      ) : status ? (
        <div className="status" role={status.ok ? 'status' : 'alert'}>
          <div className="status__head">
            <Dot tone={status.ok ? 'green' : 'red'} />
            {status.ok ? `Connected to Lulu ${status.env}` : `Lulu ${status.env} rejected the credentials`}
            <Chip tone="neutral" className="mono">
              {compactUrl(status.baseUrl)}
            </Chip>
          </div>
          {status.ok ? (
            <div className="muted small">
              Token exchange and an authenticated call succeeded.
              {status.printJobs !== undefined ? ` ${formatNumber(status.printJobs)} print job${status.printJobs === 1 ? '' : 's'} on this account.` : ''}
            </div>
          ) : (
            <div className="muted" style={{ lineHeight: 1.5 }}>
              {status.error ?? 'Lulu did not answer.'}
            </div>
          )}
        </div>
      ) : null}
      {keySet ? <LuluWebhookBlock /> : null}
    </section>
  );
}

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="content">
        <div className="settings">
          <ImmichSection />
          <PublicUrlSection />
          <PetsSection />
          <LuluSection />
          <NotificationsSection />
          <AiSection />
        </div>
      </div>
    </>
  );
}
