import { AttachmentDropzone } from '../components/AttachmentDropzone';
import { Card, PageHeader } from '../components/ui';

/** Dev-only page for exercising the attachment pipeline before real screens use it. */
export function DevAttachments() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Dev: attachments" />
      <Card title="Scratch owner" description="Files here are linked to owner dev/scratch.">
        <AttachmentDropzone ownerType="dev" ownerId="scratch" pasteAnywhere />
      </Card>
    </div>
  );
}
