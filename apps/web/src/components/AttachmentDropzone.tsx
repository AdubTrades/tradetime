import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, ImagePlus, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { api, type Attachment, type AttachmentLink } from '../lib/api';
import { FileDropTarget } from './FileDropTarget';

interface Props {
  ownerType: string;
  ownerId: string;
  role?: string;
  /** Listen for Cmd+V anywhere on the page, not just when the zone has focus. */
  pasteAnywhere?: boolean;
  /** Extra controls under each thumbnail (e.g. "Send to Playbook"). */
  renderActions?: (attachment: Attachment) => ReactNode;
}

/** Attach screenshots/receipts by drag-and-drop, clipboard paste or file picker. */
export function AttachmentDropzone({ ownerType, ownerId, role, pasteAnywhere = false, renderActions }: Props) {
  const qc = useQueryClient();
  const queryKey = ['attachments', ownerType, ownerId];

  const { data: items = [] } = useQuery({
    queryKey,
    queryFn: () => api.get<{ link: AttachmentLink; attachment: Attachment }[]>(`/attachments/for/${ownerType}/${ownerId}`),
  });

  const upload = useMutation({
    mutationFn: (files: File[]) => {
      const form = new FormData();
      for (const f of files) form.append('file', f);
      form.append('ownerType', ownerType);
      form.append('ownerId', ownerId);
      if (role) form.append('role', role);
      return api.post('/attachments', form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const remove = useMutation({
    mutationFn: (linkId: string) => api.delete(`/attachments/links/${linkId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  return (
    <div className="space-y-3">
      <FileDropTarget
        onFiles={(files) => upload.mutate(files)}
        pasteAnywhere={pasteAnywhere}
        label="Add attachment: drop, paste or click to choose a file"
        className="flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border px-4 py-6 text-sm text-muted transition hover:border-muted"
        activeClassName="border-accent bg-accent/5 text-text"
      >
        <ImagePlus size={20} aria-hidden />
        <span>{upload.isPending ? 'Uploading…' : 'Drop, paste (⌘V) or click to add a screenshot or PDF'}</span>
      </FileDropTarget>
      {upload.error && <p className="text-sm text-loss">{upload.error.message}</p>}
      {items.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
          {items.map(({ link, attachment }) => (
            <li key={link.id} className="group relative overflow-hidden rounded-md border border-border bg-surface-2">
              <a href={`/api/attachments/${attachment.id}/file`} target="_blank" rel="noreferrer" className="block aspect-video">
                {attachment.mime.startsWith('image/') ? (
                  <img src={`/api/attachments/${attachment.id}/file`} alt={attachment.originalName ?? 'Attachment'} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full flex-col items-center justify-center gap-1 p-2 text-xs text-muted">
                    <FileText size={20} aria-hidden />
                    <span className="line-clamp-2 text-center">{attachment.originalName ?? 'PDF'}</span>
                  </span>
                )}
              </a>
              <button
                type="button"
                onClick={() => remove.mutate(link.id)}
                className="absolute top-1 right-1 rounded bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                aria-label="Remove attachment"
              >
                <X size={14} />
              </button>
              {renderActions && <div className="border-t border-border p-1">{renderActions(attachment)}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
