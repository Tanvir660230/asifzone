"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HomepageSection, HomepageSectionType, UpdateHomepageSectionInput } from "@clothing-brand/shared";
import { PageHeader } from "@/components/admin/page-header";
import { ContentSubNav } from "@/components/admin/content-subnav";
import { SectionList } from "@/components/admin/homepage/section-list";
import { AddSectionMenu } from "@/components/admin/homepage/add-section-menu";
import { SectionConfigPanel, type SectionSavePayload } from "@/components/admin/homepage/section-config-panel";
import { SECTION_META } from "@/components/admin/homepage/section-meta";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import * as homepageSectionsApi from "@/lib/api/admin-homepage-sections";
import { ApiError } from "@/lib/api-client";

const QUERY_KEY = ["admin-homepage-sections"];

export default function HomepageBuilderPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: QUERY_KEY, queryFn: homepageSectionsApi.listHomepageSections });
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const [editingSection, setEditingSection] = useState<HomepageSection | null>(null);
  const [creatingType, setCreatingType] = useState<HomepageSectionType | null>(null);

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      homepageSectionsApi.updateHomepageSection(id, { isActive }),
    onSuccess: invalidate,
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Couldn't update the section"),
  });
  const reorderMutation = useMutation({
    mutationFn: homepageSectionsApi.reorderHomepageSections,
    onSuccess: invalidate,
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Couldn't save the new order"),
  });
  const deleteMutation = useMutation({
    mutationFn: homepageSectionsApi.deleteHomepageSection,
    onSuccess: () => {
      invalidate();
      toast.success("Section deleted");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Couldn't delete the section"),
  });
  const createMutation = useMutation({ mutationFn: homepageSectionsApi.createHomepageSection });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateHomepageSectionInput }) =>
      homepageSectionsApi.updateHomepageSection(id, input),
  });

  const sections = data?.sections ?? [];

  async function handleDelete(section: HomepageSection) {
    if (!(await confirm(`Delete this ${SECTION_META[section.type].label.toLowerCase()}? This can't be undone.`))) return;
    deleteMutation.mutate(section.id);
  }

  async function handleConfigSubmit(payload: SectionSavePayload) {
    // `payload.startsAt`/`endsAt` are datetime-local strings, not Date objects — the API validates
    // and coerces them with zod's `coerce.date()` server-side, same as the coupon admin form's
    // date inputs do, so the cast here is just satisfying the client's Zod-inferred input type.
    const schedule = { startsAt: payload.startsAt as unknown as Date | null, endsAt: payload.endsAt as unknown as Date | null };
    try {
      if (editingSection) {
        await updateMutation.mutateAsync({ id: editingSection.id, input: { config: payload.config, ...schedule } });
        setEditingSection(null);
      } else if (creatingType) {
        await createMutation.mutateAsync({ type: creatingType, config: payload.config, isActive: true, ...schedule });
        setCreatingType(null);
      }
      await invalidate();
      toast.success("Homepage updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't save the section");
    }
  }

  return (
    <div>
      <PageHeader
        title="Homepage Builder"
        description="Drag to reorder, toggle sections on or off, and edit each section's content."
      />

      <ContentSubNav />

      {isLoading && <p className="text-ink-400">Loading…</p>}
      {!isLoading && (
        <SectionList
          sections={sections}
          onReorder={(ids) => reorderMutation.mutate(ids)}
          onToggle={(section, isActive) => toggleMutation.mutate({ id: section.id, isActive })}
          onEdit={(section) => setEditingSection(section)}
          onDelete={handleDelete}
        />
      )}

      <div className="mt-4">
        <AddSectionMenu onAdd={(type) => setCreatingType(type)} />
      </div>

      {editingSection && (
        <SectionConfigPanel
          type={editingSection.type}
          initialConfig={editingSection.config}
          initialStartsAt={editingSection.startsAt}
          initialEndsAt={editingSection.endsAt}
          onSubmit={handleConfigSubmit}
          onClose={() => setEditingSection(null)}
        />
      )}
      {creatingType && (
        <SectionConfigPanel
          type={creatingType}
          initialConfig={{}}
          onSubmit={handleConfigSubmit}
          onClose={() => setCreatingType(null)}
        />
      )}
      {confirmDialog}
    </div>
  );
}
