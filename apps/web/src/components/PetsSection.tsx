import { useState } from 'react';
import type { FormEvent } from 'react';
import type { SavedPet } from '@bookbinder/shared';
import { Icon } from './Icon.tsx';
import { Button, Chip, Field, Note, Skeleton, TextInput } from './ui.tsx';
import { useSavePets, useSettings, useSmartPreview } from '../lib/queries.ts';
import { useDebounced } from '../lib/hooks.ts';
import { errorMessage, thumbnailUrl } from '../lib/api.ts';

const MAX_EXAMPLES = 10;

function newId(): string {
  return `pet-${globalThis.crypto.randomUUID()}`;
}

interface Draft {
  id: string;
  name: string;
  query: string;
  exampleAssetIds: string[];
}

/** Add/edit form for one pet: a name, the smart query, and example photos picked from the query's matches. */
function PetForm({ initial, ready, saving, onSave, onCancel }: { initial: Draft; ready: boolean; saving: boolean; onSave: (pet: SavedPet) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [submitted, setSubmitted] = useState(false);
  // Every keystroke would be a CLIP search on the Immich server; wait for the typing to pause.
  const debouncedQuery = useDebounced(draft.query, 500);
  const preview = useSmartPreview(debouncedQuery, ready);
  const nameError = submitted && !draft.name.trim() ? 'Give the pet a name.' : undefined;
  const queryError = submitted && !draft.query.trim() ? 'Describe the pet the way you would search for it.' : undefined;
  const toggle = (id: string) =>
    setDraft((d) => ({
      ...d,
      exampleAssetIds: d.exampleAssetIds.includes(id) ? d.exampleAssetIds.filter((x) => x !== id) : d.exampleAssetIds.length < MAX_EXAMPLES ? [...d.exampleAssetIds, id] : d.exampleAssetIds,
    }));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!draft.name.trim() || !draft.query.trim()) return;
    onSave({ id: draft.id, name: draft.name.trim(), query: draft.query.trim(), exampleAssetIds: draft.exampleAssetIds });
  };
  const shown = preview.data?.items ?? [];
  // Examples chosen earlier that the current matches do not show stay listed so they can be removed.
  const hidden = draft.exampleAssetIds.filter((id) => !shown.some((it) => it.id === id));
  return (
    <form className="stack pet-form" style={{ gap: 14 }} onSubmit={onSubmit} noValidate>
      <div className="form-grid">
        <Field label="Name" error={nameError}>
          {({ id, describedBy, invalid }) => <TextInput id={id} value={draft.name} placeholder="Biscuit" maxLength={60} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
        </Field>
        <Field label="Search" hint="What Immich's smart search should look for: breed, colour, where it usually is." error={queryError}>
          {({ id, describedBy, invalid }) => <TextInput id={id} value={draft.query} placeholder="golden retriever" maxLength={300} onChange={(e) => setDraft((d) => ({ ...d, query: e.target.value }))} aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
        </Field>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <div className="row row--between">
          <span className="label">Example photos</span>
          <span className="muted small">
            {draft.exampleAssetIds.length} of {MAX_EXAMPLES} · click a match to use it as an example; each one adds its look-alikes to a book
          </span>
        </div>
        {draft.query.trim().length > 1 ? (
          preview.isPending ? (
            <div className="smart-preview" aria-busy="true">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} height={84} />
              ))}
            </div>
          ) : preview.isError ? (
            <Note tone="error" role="alert">
              Smart search failed: {errorMessage(preview.error)}
            </Note>
          ) : shown.length === 0 ? (
            <div className="muted small">Nothing matched yet. Try a broader description.</div>
          ) : (
            <div className="smart-preview" role="group" aria-label="Matches">
              {shown.map((it) => {
                const on = draft.exampleAssetIds.includes(it.id);
                return (
                  <button key={it.id} type="button" className={`pick${on ? ' pick--on' : ''}`} aria-pressed={on} onClick={() => toggle(it.id)} title={on ? 'Remove example' : 'Use as an example'}>
                    <img src={it.thumbnailUrl} alt={it.fileName ?? ''} loading="lazy" />
                    {on ? (
                      <span className="pick__mark">
                        <Icon name="check" size={12} strokeWidth={2.4} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )
        ) : (
          <div className="muted small">Type a search to see matches.</div>
        )}
        {hidden.length > 0 ? (
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {hidden.map((id) => (
              <button key={id} type="button" className="pick pick--on pick--small" aria-pressed onClick={() => toggle(id)} title="Remove example">
                <img src={thumbnailUrl(id)} alt="" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="actions">
        <Button type="submit" variant="primary" loading={saving}>
          Save pet
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Settings → Pets (M7): saved smart queries with example photos, usable as a book source in the wizard. */
export function PetsSection() {
  const settings = useSettings();
  const save = useSavePets();
  const pets = settings.data?.pets ?? [];
  const ready = Boolean(settings.data?.immich.url && settings.data.immich.apiKeySet);
  const [editing, setEditing] = useState<Draft | undefined>();

  const commit = (next: SavedPet[]) => save.mutate(next, { onSuccess: () => setEditing(undefined) });
  const onSave = (pet: SavedPet) => commit(pets.some((p) => p.id === pet.id) ? pets.map((p) => (p.id === pet.id ? pet : p)) : [...pets, pet]);
  const onRemove = (pet: SavedPet) => {
    if (!window.confirm(`Remove ${pet.name}? Books already made from it keep their photos.`)) return;
    commit(pets.filter((p) => p.id !== pet.id));
  };

  return (
    <section className="card section" aria-labelledby="pets-title">
      <div className="section__head">
        <div>
          <h2 className="section__title" id="pets-title">
            <Icon name="paw" />
            Pets
            {pets.length > 0 ? <Chip tone="green">{pets.length} saved</Chip> : null}
          </h2>
          <p className="section__desc">
            Immich recognises people, not pets. A pet here is a saved smart search plus a few example photos; the wizard offers it as a book source and
            combines the search with look-alikes of each example.
          </p>
        </div>
        {!editing ? (
          <Button icon="plus" onClick={() => setEditing({ id: newId(), name: '', query: '', exampleAssetIds: [] })} disabled={!ready || settings.isPending} title={ready ? undefined : 'Connect Immich first'}>
            Add pet
          </Button>
        ) : null}
      </div>
      {!ready && settings.isSuccess ? <Note tone="amber">Connect Immich above to search for photos of your pets.</Note> : null}
      {save.isError ? (
        <Note tone="error" role="alert">
          Could not save: {errorMessage(save.error)}
        </Note>
      ) : null}
      {pets.length > 0 ? (
        <ul className="pets">
          {pets.map((pet) => (
            <li key={pet.id} className="pet">
              <div className="pet__thumbs" aria-hidden="true">
                {pet.exampleAssetIds.slice(0, 3).map((id) => (
                  <img key={id} src={thumbnailUrl(id)} alt="" loading="lazy" />
                ))}
                {pet.exampleAssetIds.length === 0 ? <Icon name="paw" size={22} /> : null}
              </div>
              <div className="pet__text">
                <div className="pet__name">{pet.name}</div>
                <div className="muted small">
                  “{pet.query}”{pet.exampleAssetIds.length > 0 ? ` · ${pet.exampleAssetIds.length} example${pet.exampleAssetIds.length === 1 ? '' : 's'}` : ''}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing({ ...pet, exampleAssetIds: [...pet.exampleAssetIds] })} disabled={Boolean(editing) || save.isPending}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" icon="trash" aria-label={`Remove ${pet.name}`} onClick={() => onRemove(pet)} disabled={Boolean(editing) || save.isPending} />
              </div>
            </li>
          ))}
        </ul>
      ) : !editing ? (
        <div className="muted small">No pets yet.</div>
      ) : null}
      {editing ? <PetForm key={editing.id} initial={editing} ready={ready} saving={save.isPending} onSave={onSave} onCancel={() => setEditing(undefined)} /> : null}
    </section>
  );
}
