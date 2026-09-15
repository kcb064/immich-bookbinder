import { Icon } from './Icon.tsx';
import { Button, Chip, Note } from './ui.tsx';
import { useLuluWebhook, useSettings, useSubscribeLuluWebhook, useTestLuluWebhook, useUnsubscribeLuluWebhook } from '../lib/queries.ts';
import { errorMessage } from '../lib/api.ts';

/** Settings → Lulu → Webhook (M7): Lulu pushes print-job status changes instead of the app polling every ten minutes. */
export function LuluWebhookBlock() {
  const settings = useSettings();
  const lulu = settings.data?.lulu;
  const ready = Boolean(lulu?.clientKeySet);
  const hook = useLuluWebhook(ready);
  const subscribe = useSubscribeLuluWebhook();
  const unsubscribe = useUnsubscribeLuluWebhook();
  const test = useTestLuluWebhook();
  const env = lulu?.sandbox === false ? 'production' : 'sandbox';
  const publicUrl = settings.data?.publicUrl;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row row--between">
        <div className="label">
          <Icon name="bell" size={14} /> Status webhook ({env})
        </div>
        {hook.data ? <Chip tone={hook.data.active ? 'green' : 'amber'}>{hook.data.active ? 'subscribed' : 'deactivated by Lulu'}</Chip> : ready ? <Chip>polling only</Chip> : null}
      </div>
      <div className="muted small">
        With a subscription Lulu tells this server the moment a print job moves (paid, in production, shipped); without one the app asks Lulu every ten
        minutes. Needs the public URL above and HTTPS; submissions are checked against your API secret.
      </div>
      {hook.data ? <div className="mono small muted" style={{ overflowWrap: 'anywhere' }}>{hook.data.url}</div> : null}
      {hook.data && !hook.data.active ? <Note tone="amber">Lulu switched the webhook off after repeated failures. Unsubscribe and subscribe again once the URL is reachable.</Note> : null}
      {subscribe.isError ? (
        <Note tone="error" role="alert">
          {errorMessage(subscribe.error)}
        </Note>
      ) : null}
      {unsubscribe.isError ? (
        <Note tone="error" role="alert">
          {errorMessage(unsubscribe.error)}
        </Note>
      ) : null}
      {test.isError ? (
        <Note tone="error" role="alert">
          {errorMessage(test.error)}
        </Note>
      ) : test.isSuccess ? (
        <Note tone="accent" icon="check" role="status">
          Lulu accepted the test; check the server log for the received submission.
        </Note>
      ) : null}
      <div className="actions">
        {hook.data ? (
          <>
            <Button icon="refresh" onClick={() => test.mutate()} loading={test.isPending}>
              Send a test
            </Button>
            <Button variant="danger" icon="x" onClick={() => unsubscribe.mutate()} loading={unsubscribe.isPending}>
              Unsubscribe
            </Button>
          </>
        ) : (
          <Button icon="bell" onClick={() => subscribe.mutate()} loading={subscribe.isPending} disabled={!ready || !publicUrl} title={!ready ? 'Save Lulu credentials first' : !publicUrl ? 'Set the public URL first' : undefined}>
            Subscribe
          </Button>
        )}
      </div>
    </div>
  );
}
