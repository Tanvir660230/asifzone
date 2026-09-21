"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SectionOverrideInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { CatalogSubNav } from "@/components/admin/catalog-subnav";
import { PageHeader } from "@/components/admin/page-header";
import { SectionSettingsEditor } from "@/components/admin/section-settings-editor";
import { useCanManageCatalog } from "@/hooks/use-can-manage-catalog";
import * as catalogApi from "@/lib/api/catalog";
import { describeApiError } from "@/lib/api-client";

export default function PageSectionsPage() {
  const queryClient = useQueryClient();
  const canManage = useCanManageCatalog();
  const { data, isLoading } = useQuery({ queryKey: ["catalog-sections"], queryFn: catalogApi.getGlobalSections });

  const [rows, setRows] = useState<SectionOverrideInput[]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (data) {
      setRows(data.overrides as SectionOverrideInput[]);
      setDirty(false);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => catalogApi.saveGlobalSections(rows),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-sections"] });
      queryClient.invalidateQueries({ queryKey: ["catalog-types"] });
      toast.success("Page sections saved");
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't save the page sections")),
  });

  return (
    <div>
      <PageHeader title="Catalog setup" description="Define what kinds of products the store sells, and what each kind collects and shows." />
      <CatalogSubNav />

      <p className="mb-4 max-w-3xl text-sm text-ink-500">
        These are the store-wide defaults for every product page: which sections show, in what order, under what title, and the wording of the
        shared ones (Shipping &amp; returns, Warranty). A template can override them for a whole kind of product, and a single product can override
        them again — anything left on <em>Inherit</em> follows the level above. Text that is specific to one product (highlights, what&rsquo;s included, the
        video) is written on the product itself.
      </p>

      <div className="max-w-3xl">
        {isLoading ? (
          <p className="text-ink-400">Loading…</p>
        ) : (
          <fieldset disabled={!canManage} className="disabled:opacity-80">
            <SectionSettingsEditor
              level="store"
              base={{}}
              value={rows}
              onChange={(next) => {
                setRows(next);
                setDirty(true);
              }}
            />
          </fieldset>
        )}
        <div className="mt-5 flex items-center gap-3">
          {canManage ? (
            <Button variant="brass" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save page sections"}
            </Button>
          ) : (
            <p className="text-xs text-ink-400">Only the store owner can change the page sections.</p>
          )}
          {dirty && <span className="text-xs text-ink-400">Unsaved changes</span>}
        </div>
      </div>
    </div>
  );
}
