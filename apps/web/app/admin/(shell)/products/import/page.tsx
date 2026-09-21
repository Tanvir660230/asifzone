"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet } from "lucide-react";
import { PRODUCT_IMPORT_LIMITS, type ProductImportReport, type ProductImportResult } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/admin/page-header";
import { ProductsSubNav } from "@/components/admin/products-subnav";
import { FormSection } from "@/components/admin/form-section";
import { toast } from "@/components/ui/toast";
import * as productsApi from "@/lib/api/products";
import * as catalogApi from "@/lib/api/catalog";
import { ApiError, describeApiError } from "@/lib/api-client";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import { cn } from "@/lib/utils";

const SHOW_ISSUES = 100;

const Tile = ({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "bad" | "good" }) => (
  <div className="rounded-lg border border-ink-100 bg-cream-50 px-3 py-2">
    <p className="text-[11px] uppercase tracking-wide text-ink-400">{label}</p>
    <p className={cn("text-xl font-medium", tone === "bad" && value > 0 ? "text-danger-600" : tone === "good" && value > 0 ? "text-emerald-700" : "text-ink-900")}>{value}</p>
  </div>
);

export default function ProductImportPage() {
  const queryClient = useQueryClient();
  const { data: currentAdmin } = useCurrentAdmin();
  const isOwner = currentAdmin?.admin.role === "OWNER";
  const { data: typesData } = useQuery({ queryKey: ["catalog-types", "all"], queryFn: () => catalogApi.listTypes(true) });
  const types = typesData?.types ?? [];

  const [typeId, setTypeId] = useState("");
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [report, setReport] = useState<ProductImportReport | null>(null);
  const [result, setResult] = useState<ProductImportResult | null>(null);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [busy, setBusy] = useState<"check" | "import" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    setReport(null);
    setResult(null);
    setMessage(null);
    setSkipInvalid(false);
    setFileError(null);
    setCsv("");
    setFileName("");
    if (!file) return;
    if (file.size > PRODUCT_IMPORT_LIMITS.maxBytes) {
      setFileError(`That file is ${(file.size / 1_000_000).toFixed(1)} MB; the limit is ${PRODUCT_IMPORT_LIMITS.maxBytes / 1_000_000} MB. Split it into smaller files.`);
      return;
    }
    setFileName(file.name);
    setCsv(await file.text());
  }

  async function check() {
    setBusy("check");
    setMessage(null);
    setResult(null);
    try {
      setReport((await productsApi.validateProductImport(csv)).report);
    } catch (err) {
      setReport(null);
      setMessage(describeApiError(err, "Couldn't check the file"));
    } finally {
      setBusy(null);
    }
  }

  async function runImport() {
    setBusy("import");
    setMessage(null);
    try {
      const res = await productsApi.commitProductImport(csv, skipInvalid);
      setReport(res.report);
      setResult(res.result);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success(`Imported: ${res.result.created} created, ${res.result.updated} updated`);
    } catch (err) {
      // 422: the file has errors. The API sends the fresh report along, which may differ from the last check if the catalog changed.
      const fresh = err instanceof ApiError ? (err.details as { report?: ProductImportReport } | undefined)?.report : undefined;
      if (fresh) setReport(fresh);
      setMessage(describeApiError(err, "The import failed"));
    } finally {
      setBusy(null);
    }
  }

  const willWrite = report ? report.summary.create + report.summary.update : 0;
  const hasErrors = (report?.errors.length ?? 0) > 0;
  const fileLevel = report?.errors.some((e) => e.product === null) ?? false;
  const canImport = isOwner && report !== null && willWrite > 0 && (!hasErrors || (skipInvalid && !fileLevel)) && !result && busy === null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Import & export products" action={<BackLink href="/admin/products" label="Back to Products" />} />
      <ProductsSubNav />

      <FormSection title="Get a file" description="One row per variant. Export what you have to edit it in a spreadsheet, or start from an empty template for one product type.">
        <div className="flex flex-wrap items-end gap-3">
          <a href={productsApi.exportFullCsvUrl()}>
            <Button type="button" variant="outline">
              <Download size={16} /> Export all products
            </Button>
          </a>
          <div className="flex items-end gap-2">
            <div>
              <label htmlFor="template-type" className="mb-1 block text-xs text-ink-500">
                Empty template for
              </label>
              <Select id="template-type" value={typeId} onChange={(e) => setTypeId(e.target.value)} className="h-10 w-56">
                <option value="">Any type (no attribute columns)</option>
                {types.filter((t) => t.isActive).map((t) => (
                  <option key={t.typeId} value={t.typeId}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <a href={productsApi.importTemplateUrl(typeId || undefined)}>
              <Button type="button" variant="outline">
                <FileSpreadsheet size={16} /> Download template
              </Button>
            </a>
          </div>
        </div>
        <details className="mt-4 text-sm text-ink-600">
          <summary className="cursor-pointer text-ink-800">How the file works</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Each row is one variant. Give the product&rsquo;s own columns (name, prices, category…) on its first row; the <code>slug</code> goes on every row and ties
              them together. A product whose slug already exists is updated; otherwise it is created.
            </li>
            <li>
              A blank cell on an existing product means <strong>leave it as it is</strong>. An import never deletes anything: variants missing from the file stay.
            </li>
            <li>
              New products are always created as <strong>drafts</strong>; the <code>status</code> column is only informational. Publish from the product list when they&rsquo;re complete.
              Images can&rsquo;t be imported; add them in the editor.
            </li>
            <li>
              <code>category</code> is a category&rsquo;s slug or name; <code>product_type</code> is a type&rsquo;s key or name; <code>attr:&lt;key&gt;</code> columns hold the type&rsquo;s
              details (yes/no for switches, <code>a|b</code> for multiple choices, YYYY-MM-DD for dates). <code>materials</code> looks like <code>Cotton:80|Polyester:20</code>.
            </li>
            <li>A blank <code>variant_sku</code> on a new variant gets a SKU from the store&rsquo;s SKU pattern. Changed stock is recorded in the stock history as &ldquo;Changed by CSV import&rdquo;.</li>
            <li>Lowering a price by import notifies customers who wished for the product, exactly as it does when you edit it.</li>
            <li>
              Save as <strong>CSV UTF-8</strong>. Text that begins with = + - or @ is prefixed with an apostrophe in exports so a spreadsheet can&rsquo;t run it as a formula; the apostrophe is removed on import.
            </li>
          </ul>
        </details>
      </FormSection>

      <FormSection title="Import" description="Check the file first: nothing is written until you press Import.">
        {!isOwner ? (
          <p className="text-sm text-ink-500">Only the store owner can import products, because an import can change prices across the whole catalog.</p>
        ) : (
          <div className="space-y-4">
            <div>
              <input
                type="file"
                accept=".csv,text/csv"
                aria-label="CSV file"
                onChange={(e) => onFile(e.target.files?.[0])}
                className="block w-full text-sm text-ink-700 file:mr-3 file:rounded-full file:border file:border-ink-200 file:bg-cream-50 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:border-ink-400"
              />
              {fileError && (
                <p className="mt-2 text-sm text-danger-600" role="alert">
                  {fileError}
                </p>
              )}
            </div>
            <Button type="button" variant="outline" disabled={!csv || busy !== null} onClick={check}>
              {busy === "check" ? "Checking…" : "Check file"}
            </Button>
            {message && (
              <p className="text-sm text-danger-600" role="alert">
                {message}
              </p>
            )}
          </div>
        )}
      </FormSection>

      {report && (
        <div className="space-y-5" data-testid="import-report">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Tile label="Rows" value={report.summary.rows} />
            <Tile label="To create" value={report.summary.create} tone="good" />
            <Tile label="To update" value={report.summary.update} tone="good" />
            <Tile label="Unchanged" value={report.summary.unchanged} />
            <Tile label="With errors" value={report.summary.invalid + (fileLevel ? 1 : 0)} tone="bad" />
          </div>

          {report.ignoredColumns.length > 0 && (
            <p className="text-sm text-ink-600">
              Ignored columns (not part of the import): <span className="font-medium">{report.ignoredColumns.join(", ")}</span>
            </p>
          )}

          {report.errors.length > 0 && (
            <section data-testid="import-errors">
              <h3 className="mb-2 text-sm font-medium text-danger-600">
                {report.errors.length} problem{report.errors.length === 1 ? "" : "s"} to fix
              </h3>
              <div className="overflow-x-auto rounded-lg border border-danger-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-danger-50 text-xs uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="px-3 py-2">Line</th>
                      <th className="px-3 py-2">Column</th>
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2">Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.errors.slice(0, SHOW_ISSUES).map((e, i) => (
                      <tr key={i} className="border-t border-danger-100 align-top">
                        <td className="px-3 py-2 tabular-nums">{e.row ?? "—"}</td>
                        <td className="px-3 py-2 font-mono text-xs">{e.column ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-ink-600">{e.product ?? "—"}</td>
                        <td className="px-3 py-2">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.errors.length > SHOW_ISSUES && <p className="mt-1 text-xs text-ink-500">…and {report.errors.length - SHOW_ISSUES} more.</p>}
            </section>
          )}

          {report.warnings.length > 0 && (
            <details data-testid="import-warnings" className="text-sm">
              <summary className="cursor-pointer text-brass-700">
                {report.warnings.length} note{report.warnings.length === 1 ? "" : "s"} (won&rsquo;t block the import)
              </summary>
              <ul className="mt-2 space-y-1 text-ink-700">
                {report.warnings.slice(0, SHOW_ISSUES).map((w, i) => (
                  <li key={i}>
                    {w.row ? `Line ${w.row}: ` : ""}
                    {w.message}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {report.items.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-medium text-ink-900">What will happen{report.items.length < willWrite + report.summary.unchanged ? " (first products shown)" : ""}</h3>
              <ul className="divide-y divide-ink-100 rounded-lg border border-ink-100">
                {report.items.map((item) => (
                  <li key={item.slug} className="px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
                          item.action === "create" ? "bg-emerald-100 text-emerald-800" : item.changes.length ? "bg-brass-100 text-brass-800" : "bg-ink-100 text-ink-600",
                        )}
                      >
                        {item.action === "create" ? "New" : item.changes.length ? "Update" : "No change"}
                      </span>
                      <span className="font-medium text-ink-900">{item.name}</span>
                      <span className="text-xs text-ink-400">
                        {item.slug} · {item.variants} variant{item.variants === 1 ? "" : "s"} · line{item.rows.length === 1 ? "" : "s"} {item.rows.join(", ")}
                      </span>
                    </div>
                    {item.changes.length > 0 && (
                      <ul className="mt-1 space-y-0.5 pl-1 text-xs text-ink-600">
                        {item.changes.slice(0, 12).map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                        {item.changes.length > 12 && <li>…and {item.changes.length - 12} more</li>}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {isOwner && !result && (
            <div className="flex flex-wrap items-center gap-4 border-t border-ink-100 pt-4">
              {hasErrors && !fileLevel && willWrite > 0 && (
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  <Checkbox checked={skipInvalid} onChange={(e) => setSkipInvalid(e.target.checked)} aria-label="Skip products with errors" />
                  Import the {willWrite} valid product{willWrite === 1 ? "" : "s"} and skip the {report.summary.invalid} with errors
                </label>
              )}
              <Button type="button" variant="brass" disabled={!canImport} onClick={runImport}>
                {busy === "import" ? "Importing…" : willWrite > 0 ? `Import ${willWrite} product${willWrite === 1 ? "" : "s"}` : "Nothing to import"}
              </Button>
              {hasErrors && !skipInvalid && <span className="text-xs text-ink-500">Fix the problems and check the file again, or skip the products with errors.</span>}
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm" data-testid="import-result">
          <p className="font-medium text-emerald-900">
            Import finished: {result.created} created, {result.updated} updated, {result.skipped} left as they were.
          </p>
          {result.failed.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-danger-700">
              {result.failed.map((f) => (
                <li key={f.slug}>
                  {f.slug}: {f.message}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-ink-700">
            New products are drafts. <Link href="/admin/products" className="underline">Review them in the product list</Link>, add images and publish when they&rsquo;re complete.
          </p>
        </div>
      )}
      <p className="text-xs text-ink-400">{fileName && `File: ${fileName}`}</p>
    </div>
  );
}
