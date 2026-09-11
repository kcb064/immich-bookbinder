import { PageHeader } from '../components/Shell.tsx';
import { LinkButton, Note } from '../components/ui.tsx';

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found">
        <LinkButton to="/" icon="arrowLeft">
          Back to books
        </LinkButton>
      </PageHeader>
      <div className="content content--narrow">
        <Note tone="amber">There is nothing at this address.</Note>
      </div>
    </>
  );
}
