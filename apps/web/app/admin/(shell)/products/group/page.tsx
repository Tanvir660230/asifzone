"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Info, Layers, Undo2 } from "lucide-react";
import type { GroupingPlan, Product, ProductGroupingInput } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { PermissionState } from "@/components/admin/permission-state";
import { ProductPicker } from "@/components/admin/product-picker";
import { useCapabilities } from "@/hooks/use-capability";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import * as productsApi from "@/lib/api/products";
import { ApiError } from "@/lib/api-client";
import { formatPrice, timeAgo } from "@/lib/format";
import { cn, isPaleColor } from "@/lib/utils";

type Chosen = { id: string; name: string };
type SourceChoice = { color?: string; colorHex?: string | null };

/**
 * Products › Group colours: fold separate products (one per colour or design) into one parent product, so shoppers
 * see one product with a colour picker. Variants MOVE with their SKUs, stock and history; prices stay as they are; old
 * links redirect; and every grouping can be undone from this page. Nothing is ever grouped automatically.
 */
export default function GroupProductsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <GroupProducts />
    </Suspense>
  );
}

function GroupProducts() {
  const { can, ready } = useCapabilities();
  const allowed = can("catalog.manage");
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirmDialog();
  const [parent, setParent] = useState<Chosen | null>(null);
  const [sources, setSources] = useState<Chosen[]>([]);
  const [choices, setChoices] = useState<Record<string, SourceChoice>>({});
  const [sizeRenames, setSizeRenames] = useState<Record<string, string>>({});

  // ?parent=<id> from a product's page starts with that product as the parent.
  const parentParam = params.get("parent");
  const parentFromUrl = useQuery({ queryKey: ["admin", "product", parentParam], queryFn: () => productsApi.getProduct(parentParam!), enabled: allowed && Boolean(parentParam) && !parent });
  useEffect(() => {
    if (parentFromUrl.data && !parent) setParent({ id: parentFromUrl.data.product.id, name: parentFromUrl.data.product.name });
  }, [parentFromUrl.data, parent]);

  const parentProduct = useQuery({ queryKey: ["admin", "product", parent?.id], queryFn: () => productsApi.getProduct(parent!.id), enabled: Boolean(parent) });
  const sourceProducts = useQueries({ queries: sources.map((s) => ({ queryKey: ["admin", "product", s.id], queryFn: () => productsApi.getProduct(s.id) })) });
  const loaded = sourceProducts.map((q) => q.data?.product).filter((p): p is Product => Boolean(p));

  const input: ProductGroupingInput | null = parent && sources.length ? {
    parentId: parent.id,
    sources: sources.map((s) => ({ productId: s.id, ...(choices[s.id]?.color ? { color: choices[s.id]!.color } : {}), ...(choices[s.id]?.colorHex !== undefined ? { colorHex: choices[s.id]!.colorHex } : {}) })),
    sizeRenames: Object.fromEntries(Object.entries(sizeRenames).filter(([from, to]) => to && to !== from)),
  } : null;
  // Debounced by value (a string), so typing a colour name checks once it settles — not on every keystroke or render.
  const inputKey = input ? JSON.stringify(input) : "";
  const debouncedKey = useDebouncedValue(inputKey, 400);
  const debounced = useMemo(() => (debouncedKey ? (JSON.parse(debouncedKey) as ProductGroupingInput) : null), [debouncedKey]);
  const plan = useQuery({
    queryKey: ["admin", "grouping-preview", debounced],
    queryFn: () => productsApi.previewGrouping(debounced!),
    enabled: Boolean(debounced),
    retry: false,
  });

  const groupings = useQuery({ queryKey: ["admin", "groupings", parent?.id], queryFn: () => productsApi.listGroupings(parent!.id), enabled: Boolean(parent) });

  const commit = useMutation({
    mutationFn: () => productsApi.commitGrouping(input!),
    onSuccess: ({ plan: done }) => {
      toast.success(`${done.variants.length} variants now sell under ${done.parent.name}`);
      setSources([]);
      setChoices({});
      setSizeRenames({});
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Couldn't group — nothing was changed"),
  });

  const undo = useMutation({
    mutationFn: (id: string) => productsApi.undoGrouping(id),
    onSuccess: () => {
      toast.success("Grouping undone — the products are back as they were");
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Couldn't undo — try again"),
  });

  // Sizes the moved variants use that the parent spells differently or lacks — offered for mapping.
  const parentSizes = useMemo(() => [...new Set(parentProduct.data?.product.variants.map((v) => v.size) ?? [])], [parentProduct.data]);
  const strangeSizes = useMemo(() => [...new Set(loaded.flatMap((p) => p.variants.map((v) => v.size)))].filter((s) => parentSizes.length && !parentSizes.includes(s)), [loaded, parentSizes]);

  if (ready && !allowed) return <PermissionState icon={Layers} page="Group colours" />;

  const current = plan.data?.plan;
  const canGroup = Boolean(input && current && !plan.isFetching && current.blockers.length === 0 && debouncedKey === inputKey);

  async function run() {
    if (!current) return;
    const ok = await confirm(
      `Move ${current.variants.length} variants from ${sources.length} product${sources.length === 1 ? "" : "s"} into “${current.parent.name}”? Their stock, SKUs and order history move with them, and the old pages redirect. You can undo this here.`,
      { confirmLabel: "Group products", tone: "default", title: "Group products" },
    );
    if (ok) commit.mutate();
  }

  return (
    <div className="space-y-6 pb-16">
      {dialog}
      <BackLink href="/admin/products" label="Products" />
      <PageHeader
        title="Group colours into one product"
        description="Shoppers see one product with a colour picker instead of a separate product per colour. Stock, SKUs and order history stay with each variant."
      />

      <ol className="space-y-5">
        <Step n={1} title="The product to keep" hint="Its name, description, photos and address stay. Pick the one your ads and customers already know.">
          <ProductPicker selected={parent ? [parent] : []} onChange={(list) => { setParent(list.at(-1) ?? null); setSources((s) => s.filter((x) => x.id !== list.at(-1)?.id)); }} />
          {parentProduct.data && <ProductSummary product={parentProduct.data.product} />}
        </Step>

        <Step n={2} title="Products to fold into it" hint="Each one's variants move into the product above. Choose them yourself — nothing is grouped by name.">
          <ProductPicker selected={sources} onChange={(list) => setSources(list.filter((p) => p.id !== parent?.id))} />
          {sources.length > 0 && (
            <ul className="mt-4 divide-y divide-line-subtle rounded-xl border border-line bg-surface">
              {sources.map((s, i) => {
                const p = sourceProducts[i]?.data?.product;
                const colors = p ? [...new Set(p.variants.map((v) => v.color))] : [];
                const choice = choices[s.id] ?? {};
                const hex = choice.colorHex !== undefined ? choice.colorHex : (p?.variants[0]?.colorHex ?? null);
                return (
                  <li key={s.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">{s.name}</p>
                      {p ? (
                        <p className="mt-0.5 text-xs text-fg-muted">
                          {p.variants.length} variants · {p.variants.reduce((n, v) => n + Math.max(0, v.stock), 0)} in stock · {formatPrice(Number(p.basePrice))} · {p.status === "PUBLISHED" ? "Published" : "Not published"}
                        </p>
                      ) : (
                        <Skeleton className="mt-1 h-3 w-40" />
                      )}
                    </div>
                    {colors.length === 1 ? (
                      <div className="flex items-end gap-2">
                        <div className="min-w-0 flex-1">
                          <Label htmlFor={`color-${s.id}`} className="text-xs">Colour name in the group</Label>
                          <Input id={`color-${s.id}`} value={choice.color ?? colors[0] ?? ""} onChange={(e) => setChoices((c) => ({ ...c, [s.id]: { ...c[s.id], color: e.target.value } }))} className="h-9" />
                        </div>
                        <label className="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-full border border-line" title="Swatch colour">
                          <span className={cn("absolute inset-0", hex && isPaleColor(hex) && "ring-1 ring-inset ring-line-strong")} style={{ backgroundColor: hex ?? "transparent" }} aria-hidden="true" />
                          <input type="color" value={hex ?? "#000000"} onChange={(e) => setChoices((c) => ({ ...c, [s.id]: { ...c[s.id], colorHex: e.target.value } }))} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`Swatch colour for ${s.name}`} />
                        </label>
                      </div>
                    ) : (
                      p && <p className="self-center text-xs text-fg-muted">{colors.length} colours — kept as they are</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Step>

        {strangeSizes.length > 0 && (
          <Step n={3} title="Match the sizes" hint="Sizes spelled differently from the parent's show as separate buttons. Map each to the parent's size, or keep it as a new one.">
            <ul className="grid gap-3 sm:grid-cols-2">
              {strangeSizes.map((size) => (
                <li key={size} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 truncate font-mono text-sm text-fg">{size}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
                  <Select aria-label={`Map size ${size}`} value={sizeRenames[size] ?? ""} onChange={(e) => setSizeRenames((r) => ({ ...r, [size]: e.target.value }))} className="h-9 text-sm">
                    <option value="">Keep “{size}”</option>
                    {parentSizes.map((ps) => (
                      <option key={ps} value={ps}>{ps}</option>
                    ))}
                  </Select>
                </li>
              ))}
            </ul>
          </Step>
        )}

        {input && (
          <Step n={strangeSizes.length ? 4 : 3} title="Check and group">
            {plan.isLoading || (plan.isFetching && !current) ? (
              <Skeleton className="h-40" />
            ) : plan.error ? (
              <p className="text-sm text-danger-700">{plan.error instanceof ApiError ? plan.error.message : "Couldn't check the grouping."}</p>
            ) : current ? (
              <PlanView plan={current} />
            ) : null}
            <div className="mt-5 flex items-center gap-3">
              <Button onClick={() => void run()} disabled={!canGroup} loading={commit.isPending} data-testid="group-commit">
                Group {sources.length} product{sources.length === 1 ? "" : "s"}
              </Button>
              {current && current.blockers.length > 0 && <span className="text-sm text-danger-700">Fix the problems above first.</span>}
            </div>
          </Step>
        )}
      </ol>

      {parent && (groupings.data?.groupings.length ?? 0) > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-fg">Groupings into {parent.name}</h2>
          <ul className="mt-3 divide-y divide-line-subtle">
            {groupings.data!.groupings.map((g) => (
              <li key={g.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm text-fg">{g.sources.map((s) => s.name).join(", ")}</p>
                  <p className="text-xs text-fg-muted">
                    {g.variantCount} variants · {timeAgo(g.createdAt)}
                    {g.createdByName ? ` by ${g.createdByName}` : ""}
                  </p>
                </div>
                {g.undoneAt ? (
                  <Badge variant="neutral">Undone {timeAgo(g.undoneAt)}</Badge>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    loading={undo.isPending && undo.variables === g.id}
                    onClick={async () => {
                      if (await confirm("Put these products back as they were before grouping? Their variants, photos, reviews and pages return; sales made meanwhile stay recorded.", { confirmLabel: "Undo grouping", tone: "danger", title: "Undo grouping" })) undo.mutate(g.id);
                    }}
                  >
                    <Undo2 className="h-4 w-4" aria-hidden /> Undo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {parent && (
        <p className="text-sm text-fg-muted">
          After grouping, add photos to each colour and check the order of colours in{" "}
          <Link href={`/admin/products/${parent.id}`} className="font-medium text-accent hover:underline">
            {parent.name}
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <li className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-900 text-xs font-semibold text-cream-50">{n}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>}
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </li>
  );
}

function ProductSummary({ product }: { product: Product }) {
  const colors = [...new Set(product.variants.map((v) => v.color))].filter(Boolean);
  return (
    <p className="mt-3 text-xs text-fg-muted">
      {product.variants.length} variants · {colors.length ? colors.join(", ") : "no colour"} · {formatPrice(Number(product.basePrice))}
    </p>
  );
}

function PlanView({ plan }: { plan: GroupingPlan }) {
  return (
    <div className="space-y-4">
      {plan.blockers.length > 0 && (
        <ul className="space-y-1.5 rounded-xl bg-danger-50 p-4 text-sm text-danger-700" role="alert">
          {plan.blockers.map((b) => (
            <li key={b} className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {b}
            </li>
          ))}
        </ul>
      )}
      {plan.notes.length > 0 && (
        <ul className="space-y-1.5 rounded-xl bg-surface-muted p-4 text-sm text-fg">
          {plan.notes.map((n) => (
            <li key={n} className="flex gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" aria-hidden /> {n}
            </li>
          ))}
        </ul>
      )}
      <TableContainer>
        <Table className="min-w-[32rem]">
          <caption className="sr-only">Variants that will move</caption>
          <TableHead>
            <tr>
              <TableHeaderCell>SKU</TableHeaderCell>
              <TableHeaderCell>Becomes</TableHeaderCell>
              <TableHeaderCell align="right">Stock</TableHeaderCell>
              <TableHeaderCell align="right">Price</TableHeaderCell>
              <TableHeaderCell>From</TableHeaderCell>
            </tr>
          </TableHead>
          <tbody>
            {plan.variants.map((v) => (
              <TableRow key={v.variantId} className={cn(!v.active && "text-fg-muted")}>
                <TableCell className="font-mono text-xs">{v.sku}</TableCell>
                <TableCell>
                  {v.color} / {v.size} {!v.active && <Badge variant="neutral">Off</Badge>}
                </TableCell>
                <TableCell align="right" className="tabular-nums">{v.stock}</TableCell>
                <TableCell align="right" className="tabular-nums">{formatPrice(Number(v.price))}</TableCell>
                <TableCell className="max-w-[12rem] truncate text-xs text-fg-muted">{v.fromProductName}</TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableContainer>
      <p className="text-xs text-fg-muted">
        Also moves {plan.images} photo{plan.images === 1 ? "" : "s"} and {plan.reviews} review{plan.reviews === 1 ? "" : "s"}. Old addresses redirect: {plan.redirects.filter((r) => r.from.startsWith("/product/")).map((r) => r.from).join(", ")}.
      </p>
    </div>
  );
}
