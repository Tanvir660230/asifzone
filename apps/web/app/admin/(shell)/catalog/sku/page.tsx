"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SKU_TOKEN_HELP, defaultTypeCode, renderSkuPattern, validateSkuPattern } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { CatalogSubNav } from "@/components/admin/catalog-subnav";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { useCanManageCatalog } from "@/hooks/use-can-manage-catalog";
import * as catalogApi from "@/lib/api/catalog";
import { describeApiError } from "@/lib/api-client";

function TypeCodeRow({ type, canManage, onSaved }: { type: catalogApi.ManagedType; canManage: boolean; onSaved: () => void }) {
  const [value, setValue] = useState(type.skuCode ?? "");
  useEffect(() => setValue(type.skuCode ?? ""), [type.skuCode]);

  const save = useMutation({
    mutationFn: () => catalogApi.updateType(type.id, { skuCode: value }),
    onSuccess: () => {
      toast.success(`SKU code saved for ${type.name}`);
      onSaved();
    },
    onError: (err) => {
      setValue(type.skuCode ?? "");
      toast.error(describeApiError(err, "Couldn't save the SKU code"));
    },
  });

  return (
    <tr className="border-t border-ink-100">
      <td className="px-4 py-2.5 text-ink-900">{type.name}</td>
      <td className="px-4 py-2.5">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          onBlur={() => value !== (type.skuCode ?? "") && save.mutate()}
          placeholder={defaultTypeCode(type.name)}
          disabled={!canManage}
          maxLength={6}
          className="h-8 w-28 font-mono text-xs uppercase"
          aria-label={`SKU code for ${type.name}`}
        />
      </td>
    </tr>
  );
}

export default function SkuSettingsPage() {
  const queryClient = useQueryClient();
  const canManage = useCanManageCatalog();
  const { data } = useQuery({ queryKey: ["catalog-sku-settings"], queryFn: catalogApi.getSkuSettings });
  const { data: typesData } = useQuery({ queryKey: ["catalog-types", "manage"], queryFn: catalogApi.listManagedTypes });

  const [prefix, setPrefix] = useState("");
  const [pattern, setPattern] = useState("");
  useEffect(() => {
    if (data) {
      setPrefix(data.settings.skuPrefix);
      setPattern(data.settings.skuPattern);
    }
  }, [data]);

  const patternError = pattern ? validateSkuPattern(pattern) : null;
  const example = !patternError && pattern ? renderSkuPattern(pattern, { prefix: prefix || "AZ", typeCode: "PNJ", color: "Black", size: "M", seq: 1 }) : "";
  const example2 = !patternError && pattern ? renderSkuPattern(pattern, { prefix: prefix || "AZ", typeCode: "SHO", color: "Brown", size: "42", seq: 2 }) : "";
  const dirty = data && (prefix !== data.settings.skuPrefix || pattern !== data.settings.skuPattern);

  const save = useMutation({
    mutationFn: () => catalogApi.updateSkuSettings({ skuPrefix: prefix, skuPattern: pattern }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-sku-settings"] });
      toast.success("SKU settings saved");
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't save the SKU settings")),
  });

  return (
    <div>
      <PageHeader title="Catalog setup" description="Define what kinds of products the store sells, and what each kind collects and shows." />
      <CatalogSubNav />

      <p className="mb-4 text-sm text-ink-500">
        SKUs are generated from a pattern when you click <strong>Generate</strong> next to a variant&rsquo;s SKU. Numbers are counted per product type and never
        reused, so two products can&rsquo;t end up with the same SKU. Existing SKUs are never changed.
      </p>

      <div className="max-w-2xl space-y-8">
        <FormSection title="Pattern">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[8rem_1fr]">
            <div>
              <Label htmlFor="sku-prefix">Prefix</Label>
              <Input id="sku-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} disabled={!canManage} maxLength={8} className="font-mono uppercase" />
            </div>
            <div>
              <Label htmlFor="sku-pattern">Pattern</Label>
              <Input id="sku-pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} disabled={!canManage} className="font-mono" aria-invalid={Boolean(patternError)} />
              {patternError && <p className="mt-1 text-xs text-danger-600">{patternError}</p>}
            </div>
          </div>

          {canManage && (
            <div className="flex flex-wrap gap-1.5" aria-label="Insert a token">
              {SKU_TOKEN_HELP.map((t) => (
                <button key={t.token} type="button" title={t.meaning} onClick={() => setPattern((p) => `${p}${p && !p.endsWith("-") ? "-" : ""}${t.token}`)} className="rounded-full border border-ink-200 px-2.5 py-0.5 font-mono text-xs text-ink-600 hover:border-ink-400 hover:text-ink-900">
                  {t.token}
                </button>
              ))}
            </div>
          )}

          <ul className="space-y-0.5 text-xs text-ink-500">
            {SKU_TOKEN_HELP.map((t) => (
              <li key={t.token}>
                <span className="font-mono text-ink-700">{t.token}</span> — {t.meaning}
              </li>
            ))}
          </ul>

          <div className="rounded-lg border border-ink-100 bg-white p-3" data-testid="sku-example">
            <p className="mb-1 text-xs uppercase tracking-wide text-ink-400">Examples</p>
            {example ? (
              <p className="font-mono text-sm text-ink-900">
                {example} <span className="text-ink-300">·</span> {example2}
              </p>
            ) : (
              <p className="text-sm text-ink-400">—</p>
            )}
          </div>

          {canManage ? (
            <Button variant="brass" disabled={!dirty || Boolean(patternError) || !prefix || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          ) : (
            <p className="text-xs text-ink-400">Only the store owner can change the SKU pattern.</p>
          )}
        </FormSection>

        <FormSection title="SKU code per product type" description="Used by {TYPE}. Leave blank to use the first three letters of the type's name (shown greyed).">
          <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-2">Product type</th>
                  <th className="px-4 py-2">Code</th>
                </tr>
              </thead>
              <tbody>
                {(typesData?.types ?? []).map((t) => (
                  <TypeCodeRow key={t.id} type={t} canManage={canManage} onSaved={() => queryClient.invalidateQueries({ queryKey: ["catalog-types"] })} />
                ))}
              </tbody>
            </table>
          </div>
        </FormSection>
      </div>
    </div>
  );
}
