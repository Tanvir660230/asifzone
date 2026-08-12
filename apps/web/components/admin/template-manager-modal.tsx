"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Save } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import * as smsTemplatesApi from "@/lib/api/sms-templates";
import { ApiError } from "@/lib/api-client";

interface TemplateManagerModalProps {
  open: boolean;
  onClose: () => void;
}

export function TemplateManagerModal({ open, onClose }: TemplateManagerModalProps) {
  const queryClient = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [newName, setNewName] = useState("");
  const [newBody, setNewBody] = useState("");
  const [editing, setEditing] = useState<Record<string, { name: string; body: string }>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["sms-templates"],
    queryFn: smsTemplatesApi.listSmsTemplates,
    enabled: open,
  });
  const templates = data?.templates ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["sms-templates"] });
  }

  const createMutation = useMutation({
    mutationFn: () => smsTemplatesApi.createSmsTemplate({ name: newName, body: newBody }),
    onSuccess: () => {
      invalidate();
      setNewName("");
      setNewBody("");
      toast.success("Template added");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to add template"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name, body }: { id: string; name: string; body: string }) =>
      smsTemplatesApi.updateSmsTemplate(id, { name, body }),
    onSuccess: () => {
      invalidate();
      toast.success("Template saved");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to save template"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => smsTemplatesApi.deleteSmsTemplate(id),
    onSuccess: () => {
      invalidate();
      toast.success("Template deleted");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to delete template"),
  });

  return (
    <Modal open={open} onClose={onClose} title="SMS Templates" widthClassName="max-w-2xl">
      <div className="space-y-4">
        {isLoading && <p className="text-sm text-ink-400">Loading…</p>}
        {templates.map((t) => {
          const draft = editing[t.id] ?? { name: t.name, body: t.body };
          const dirty = draft.name !== t.name || draft.body !== t.body;
          return (
            <div key={t.id} className="space-y-2 rounded-lg border border-ink-100 p-3">
              <Input
                value={draft.name}
                onChange={(e) => setEditing((prev) => ({ ...prev, [t.id]: { ...draft, name: e.target.value } }))}
                className="font-medium"
              />
              <Textarea
                rows={2}
                value={draft.body}
                onChange={(e) => setEditing((prev) => ({ ...prev, [t.id]: { ...draft, body: e.target.value } }))}
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleteMutation.isPending}
                  onClick={async () => {
                    if (await confirm(`Delete the "${t.name}" template?`)) deleteMutation.mutate(t.id);
                  }}
                >
                  <Trash2 size={13} /> Delete
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!dirty || updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ id: t.id, ...draft })}
                >
                  <Save size={13} /> Save
                </Button>
              </div>
            </div>
          );
        })}

        <div className="space-y-2 rounded-lg border border-dashed border-ink-200 p-3">
          <Input placeholder="New template name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Textarea rows={2} placeholder="Template text…" value={newBody} onChange={(e) => setNewBody(e.target.value)} />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!newName.trim() || !newBody.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              <Plus size={13} /> Add template
            </Button>
          </div>
        </div>
      </div>
      {confirmDialog}
    </Modal>
  );
}
