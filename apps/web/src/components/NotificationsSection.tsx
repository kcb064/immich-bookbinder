import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { NotificationEvents, NotifyKind } from '@bookbinder/shared';
import { Icon } from './Icon.tsx';
import { Button, Chip, Dot, Field, Note, PasswordInput, Select, TextInput } from './ui.tsx';
import { useClearNotifications, useSaveNotifications, useSettings, useTestNotifications } from '../lib/queries.ts';
import { errorMessage } from '../lib/api.ts';

const KINDS: Array<{ id: NotifyKind; name: string; urlHint: string; tokenHint: string; placeholder: string }> = [
  { id: 'ntfy', name: 'ntfy', urlHint: 'The topic URL, e.g. https://ntfy.sh/bookbinder or your own server.', tokenHint: 'Access token, if the topic is protected.', placeholder: 'https://ntfy.sh/bookbinder' },
  { id: 'gotify', name: 'Gotify', urlHint: 'Your Gotify server; the app POSTs to /message.', tokenHint: 'Application token from Gotify → Apps.', placeholder: 'https://gotify.example.com' },
  { id: 'webhook', name: 'Webhook', urlHint: 'Any URL that accepts a JSON POST (Home Assistant, n8n, Discord via a relay...).', tokenHint: 'Optional bearer token sent in the Authorization header.', placeholder: 'https://example.com/hooks/bookbinder' },
];

const EVENTS: Array<{ key: keyof NotificationEvents; name: string; hint: string }> = [
  { key: 'renderDone', name: 'PDFs and previews', hint: 'when a render finishes or fails' },
  { key: 'orderStatus', name: 'Orders', hint: 'every Lulu status change: quoted, unpaid, in production, shipped, rejected' },
  { key: 'selectionFailed', name: 'Selection failures', hint: 'when a photo selection run stops with an error' },
];

function isValidUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Settings → Notifications (M7): one ntfy topic, Gotify server or webhook, with per-event switches and a test button. */
export function NotificationsSection() {
  const settings = useSettings();
  const stored = settings.data?.notifications;
  const save = useSaveNotifications();
  const clear = useClearNotifications();
  const test = useTestNotifications();
  const [kind, setKind] = useState<NotifyKind>('ntfy');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [events, setEvents] = useState<NotificationEvents>({ renderDone: true, orderStatus: true, selectionFailed: true });
  const [dirty, setDirty] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (dirty || !stored) return;
    if (stored.kind) setKind(stored.kind);
    setUrl(stored.url ?? '');
    setEvents(stored.events);
  }, [stored, dirty]);

  const trimmed = url.trim().replace(/\/+$/, '');
  const urlError = submitted && !isValidUrl(trimmed) ? 'Enter a full URL starting with http:// or https://' : undefined;
  const meta = KINDS.find((k) => k.id === kind)!;
  const payload = () => ({ kind, url: trimmed, ...(token ? { token } : {}), events });

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!isValidUrl(trimmed)) return;
    save.mutate(payload(), {
      onSuccess: () => {
        setDirty(false);
        setToken('');
        test.reset();
      },
    });
  };
  const onTest = () => {
    setSubmitted(true);
    if (!isValidUrl(trimmed)) return;
    // Unsaved values are tested as typed; a saved token is kept unless a new one was typed.
    test.mutate(dirty || token ? payload() : undefined);
  };
  const onClear = () => {
    if (!window.confirm('Stop sending notifications and forget the URL and token?')) return;
    clear.mutate(undefined, {
      onSuccess: () => {
        setUrl('');
        setToken('');
        setDirty(false);
        setSubmitted(false);
        test.reset();
      },
    });
  };
  const touch = () => {
    setDirty(true);
    test.reset();
  };

  return (
    <section className="card section" aria-labelledby="notify-title">
      <div className="section__head">
        <div>
          <h2 className="section__title" id="notify-title">
            <Icon name="bell" />
            Notifications
            {settings.isSuccess ? stored?.configured ? <Chip tone="green" icon="check">{KINDS.find((k) => k.id === stored.kind)?.name ?? stored.kind}</Chip> : <Chip tone="neutral">off</Chip> : null}
          </h2>
          <p className="section__desc">
            A short message when a PDF is ready, an order moves or a selection fails. Sent once with one retry; nothing is queued. Links in the
            message use the public URL above when it is set.
          </p>
        </div>
      </div>
      <form className="stack" style={{ gap: 20 }} onSubmit={onSave} noValidate>
        <div className="form-grid">
          <Field label="Service">
            {({ id }) => (
              <Select
                id={id}
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as NotifyKind);
                  touch();
                }}
              >
                {KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="URL" hint={meta.urlHint} error={urlError}>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                type="url"
                inputMode="url"
                placeholder={meta.placeholder}
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  touch();
                }}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                disabled={settings.isPending}
              />
            )}
          </Field>
          <Field label="Token" hint={stored?.tokenSet ? `A token is saved. ${meta.tokenHint} Type a new one to replace it.` : meta.tokenHint}>
            {({ id, describedBy }) => (
              <PasswordInput
                id={id}
                autoComplete="off"
                placeholder={stored?.tokenSet ? '•••••••••••••••• (saved)' : 'Optional'}
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  touch();
                }}
                aria-describedby={describedBy}
              />
            )}
          </Field>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="label">Send a message for</div>
          {EVENTS.map((ev) => (
            <label key={ev.key} className="toggle">
              <input
                type="checkbox"
                className="visually-hidden"
                checked={events[ev.key]}
                onChange={(e) => {
                  setEvents((v) => ({ ...v, [ev.key]: e.target.checked }));
                  touch();
                }}
              />
              <span className={`toggle__track${events[ev.key] ? ' toggle__track--on' : ''}`} aria-hidden="true">
                <span className="toggle__knob" />
              </span>
              <span>
                <strong>{ev.name}</strong> <span className="muted">{ev.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {save.isError ? (
          <Note tone="error" role="alert">
            Could not save: {errorMessage(save.error)}
          </Note>
        ) : null}
        {clear.isError ? (
          <Note tone="error" role="alert">
            Could not remove: {errorMessage(clear.error)}
          </Note>
        ) : null}
        <div className="actions">
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty || settings.isPending}>
            Save
          </Button>
          <Button icon="refresh" onClick={onTest} loading={test.isPending} disabled={!trimmed} title="Send a test message now">
            Send a test
          </Button>
          {stored?.configured ? (
            <Button variant="danger" icon="x" onClick={onClear} loading={clear.isPending} style={{ marginLeft: 'auto' }}>
              Turn off
            </Button>
          ) : null}
        </div>
      </form>
      {test.isError ? (
        <div className="status" role="alert">
          <div className="status__head">
            <Dot tone="red" />
            Test failed
          </div>
          <div className="muted">{errorMessage(test.error)}</div>
        </div>
      ) : test.data ? (
        <div className="status" role={test.data.ok ? 'status' : 'alert'}>
          <div className="status__head">
            <Dot tone={test.data.ok ? 'green' : 'red'} />
            {test.data.ok ? 'Delivered: check your device' : 'Not delivered'}
            {test.data.status ? (
              <Chip tone="neutral" className="mono">
                HTTP {test.data.status}
              </Chip>
            ) : null}
          </div>
          {test.data.error ? <div className="muted">{test.data.error}</div> : null}
        </div>
      ) : null}
    </section>
  );
}
