import { Link } from 'react-router';
import { PageHeader } from '../components/Shell.tsx';
import { Icon } from '../components/Icon.tsx';
import { PetsSection } from '../components/PetsSection.tsx';
import { Note, Skeleton } from '../components/ui.tsx';
import { usePeople, useSettings } from '../lib/queries.ts';
import { errorMessage } from '../lib/api.ts';

/** People named in Immich (books start from them in the wizard) and the pets saved as smart searches (M7). */
export function PeoplePage() {
  const settings = useSettings();
  const ready = Boolean(settings.data?.immich.url && settings.data.immich.apiKeySet);
  const people = usePeople(ready);
  const named = (people.data?.people ?? []).filter((p) => p.name.trim()).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <PageHeader title="People & pets" />
      <div className="content">
        <div className="settings">
          <section className="card section" aria-labelledby="people-title">
            <div className="section__head">
              <div>
                <h2 className="section__title" id="people-title">
                  <Icon name="people" />
                  People
                </h2>
                <p className="section__desc">
                  Faces Immich has named. Start a book from any of them with <Link to="/new">New book → People</Link>, or star them as featured people on any
                  book so they are never left out. Name more faces in Immich itself.
                </p>
              </div>
            </div>
            {!ready && settings.isSuccess ? <Note tone="amber">Connect Immich in Settings to see people.</Note> : null}
            {people.isPending && ready ? <Skeleton height={64} /> : null}
            {people.isError ? (
              <Note tone="error" role="alert">
                Could not load people: {errorMessage(people.error)}
              </Note>
            ) : null}
            {people.data ? (
              named.length === 0 ? (
                <div className="muted small">Immich has no named people yet.</div>
              ) : (
                <div className="people-grid">
                  {named.map((p) => (
                    <span key={p.id} className="person">
                      <span className="person__thumb">{p.thumbnailUrl ? <img src={`/api/immich/people/${encodeURIComponent(p.id)}/thumbnail`} alt="" loading="lazy" /> : <Icon name="people" />}</span>
                      <span className="person__name">{p.name}</span>
                    </span>
                  ))}
                </div>
              )
            ) : null}
          </section>
          <PetsSection />
        </div>
      </div>
    </>
  );
}
