import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { AI_MODELS } from '@bookbinder/shared';
import { Icon } from './Icon.tsx';
import { Button, Chip, Dot, Field, Note, PasswordInput, Select, Skeleton } from './ui.tsx';
import { formatUsd } from './AiCard.tsx';
import { useClearAi, useSaveAi, useSettings, useTestAi } from '../lib/queries.ts';
import { errorMessage } from '../lib/api.ts';
import { formatNumber } from '../lib/format.ts';

const AI_DOC = 'https://github.com/kcb064/immich-bookbinder/blob/main/docs/ai.md';

/** Settings → Claude (M7): the switch, the key (encrypted, never shown again), the model, and a test call. */
export function AiSection() {
  const settings = useSettings();
  const stored = settings.data?.ai;
  const save = useSaveAi();
  const clear = useClearAi();
  const test = useTestAi();
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState(AI_MODELS[0]!.id);
  const [apiKey, setApiKey] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty || !stored) return;
    setEnabled(stored.enabled);
    setModel(stored.model);
  }, [stored, dirty]);

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ enabled, model, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }, {
      onSuccess: () => {
        setDirty(false);
        setApiKey('');
        test.reset();
      },
    });
  };
  const onClear = () => {
    if (!window.confirm('Turn Claude features off and forget the API key?')) return;
    clear.mutate(undefined, {
      onSuccess: () => {
        setDirty(false);
        setApiKey('');
        test.reset();
      },
    });
  };
  const touch = () => {
    setDirty(true);
    test.reset();
  };
  const ready = Boolean(stored?.enabled && stored.apiKeySet);

  return (
    <section className="card section" aria-labelledby="ai-settings-title">
      <div className="section__head">
        <div>
          <h2 className="section__title" id="ai-settings-title">
            <Icon name="sparkles" />
            Claude
            {settings.isSuccess ? ready ? <Chip tone="green" icon="check">on · {stored!.model}</Chip> : <Chip tone="neutral">off</Chip> : null}
          </h2>
          <p className="section__desc">
            Optional: Claude writes captions and chapter titles, picks the best frame of a burst and drafts a foreword, with your own Anthropic API
            key. Nothing runs until you ask for it on a book page; only small thumbnails, dates and place names are sent, never originals. Every
            job shows its tokens and estimated cost.{' '}
            <a href={AI_DOC} target="_blank" rel="noreferrer">
              What is sent and when <Icon name="external" size={12} />
            </a>
          </p>
        </div>
      </div>
      <form className="stack" style={{ gap: 20 }} onSubmit={onSave} noValidate>
        <label className="toggle">
          <input
            type="checkbox"
            className="visually-hidden"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              touch();
            }}
            disabled={settings.isPending}
          />
          <span className={`toggle__track${enabled ? ' toggle__track--on' : ''}`} aria-hidden="true">
            <span className="toggle__knob" />
          </span>
          <span>
            <strong>Enable Claude features</strong> <span className="muted">{enabled ? 'on: the buttons appear on every book page.' : 'off: nothing is ever sent to Anthropic.'}</span>
          </span>
        </label>
        <div className="form-grid">
          <Field label="API key" hint={stored?.apiKeySet ? 'A key is saved. Paste a new one to replace it.' : 'From console.anthropic.com; stored encrypted on the server and never shown again.'}>
            {({ id, describedBy }) => (
              <PasswordInput
                id={id}
                autoComplete="off"
                placeholder={stored?.apiKeySet ? '•••••••••••••••• (saved)' : 'sk-ant-…'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  touch();
                }}
                aria-describedby={describedBy}
                disabled={settings.isPending}
              />
            )}
          </Field>
          <Field label="Model" hint="List prices per million tokens (input / output).">
            {({ id }) => (
              <Select
                id={id}
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  touch();
                }}
              >
                {AI_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · ${m.inputPerMTok} / ${m.outputPerMTok}
                  </option>
                ))}
              </Select>
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
            Could not remove: {errorMessage(clear.error)}
          </Note>
        ) : null}
        <div className="actions">
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
            Save
          </Button>
          <Button icon="refresh" onClick={() => test.mutate()} loading={test.isPending} disabled={!stored?.apiKeySet || dirty} title={dirty ? 'Save first' : !stored?.apiKeySet ? 'Save a key first' : 'One tiny request with the saved key'}>
            Test key
          </Button>
          {stored?.apiKeySet || stored?.enabled ? (
            <Button variant="danger" icon="x" onClick={onClear} loading={clear.isPending} style={{ marginLeft: 'auto' }}>
              Turn off and forget the key
            </Button>
          ) : null}
        </div>
      </form>
      {test.isPending ? (
        <div className="status" aria-busy="true">
          <div className="status__head">
            <Dot tone="neutral" />
            Asking Claude for one word…
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
      ) : test.data ? (
        <div className="status" role={test.data.ok ? 'status' : 'alert'}>
          <div className="status__head">
            <Dot tone={test.data.ok ? 'green' : 'red'} />
            {test.data.ok ? `Claude answered (${test.data.model})` : 'Claude did not answer'}
          </div>
          {test.data.usage ? (
            <div className="muted small mono">
              {formatNumber(test.data.usage.inputTokens)} in · {formatNumber(test.data.usage.outputTokens)} out · ≈{formatUsd(test.data.usage.costUsd)}
            </div>
          ) : null}
          {test.data.error ? <div className="muted">{test.data.error}</div> : null}
        </div>
      ) : null}
    </section>
  );
}
