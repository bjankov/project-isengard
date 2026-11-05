import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useLibrary } from '@/stores/library';
import type { WorkflowDoc } from './doc';

/** Copy the project's workflow and layout into a new workflow template. */
export function SaveAsTemplateDialog({
  open,
  onOpenChange,
  doc,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: WorkflowDoc;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && <TemplateForm doc={doc} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function TemplateForm({ doc, onDone }: { doc: WorkflowDoc; onDone: () => void }) {
  const upsert = useLibrary((s) => s.upsert);
  const [name, setName] = useState(`${doc.name} template`);
  const [description, setDescription] = useState(doc.description);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.create('template', {
        name: name.trim(),
        description,
        workflow: doc.workflow,
        layout: doc.layout,
      });
      upsert('template', res.entity);
      toast.success(`Saved template “${res.entity.name}”`, {
        description: 'New projects can start from it.',
      });
      onDone();
    } catch (err) {
      toast.error('Could not save the template', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <DialogHeader>
        <DialogTitle>Save as template</DialogTitle>
        <DialogDescription>
          Copies this workflow ({doc.workflow.nodes.length} nodes, as currently shown) so new
          projects can start from it. Project overrides and the workspace are not included.
        </DialogDescription>
      </DialogHeader>
      <Field label="Name" htmlFor="template-name">
        <Input
          id="template-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </Field>
      <Field label="Description" htmlFor="template-description">
        <Textarea
          id="template-description"
          value={description}
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !name.trim()}>
          Save template
        </Button>
      </DialogFooter>
    </form>
  );
}
