"use client";

import { use, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Layers, Trash2, X } from "lucide-react";
import { PRODUCT_FAMILY_MAX_MEMBERS, type ProductFamilyDetail } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { PermissionState } from "@/components/admin/permission-state";
import { ProductPicker } from "@/components/admin/product-picker";
import { useCapabilities } from "@/hooks/use-capability";
import { ApiError } from "@/lib/api-client";
import * as familiesApi from "@/lib/api/product-families";
import { thumbnailUrl } from "@/lib/image-url";

type Member = ProductFamilyDetail["members"][number];
const LIST = "/admin/products/families";

const STATUS: Record<string, { label: string; variant: "success" | "neutral" | "warning" | "danger" }> = {
  PUBLISHED: { label: "On the store", variant: "success" },
  TRASHED: { label: "In Trash — hidden", variant: "danger" },
};

/** Products › Product families › one family: its name, its products in tile order, an optional tile name per product. */
export default function ProductFamilyEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === "new";
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can, ready } = useCapabilities();
  const allowed = can("catalog.manage");
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const family = useQuery({ queryKey: ["admin", "product-families", id], queryFn: () => familiesApi.getProductFamily(id), enabled: allowed && !isNew });
  const [name, setName] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!family.data || dirty) return;
    setName(family.data.family.name);
    setMembers(family.data.family.members);
  }, [family.data, dirty]);

  // Closing the tab or reloading with unsaved changes asks first (the browser's own prompt), as the Studio does.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
    setError(null);
  };
  const setMembersDirty = edit(setMembers);

  const save = useMutation({
    mutationFn: () => {
      const input = { name, members: members.map((m) => ({ productId: m.productId, label: m.label ?? undefined })) };
      return isNew ? familiesApi.createProductFamily(input) : familiesApi.saveProductFamily(id, input);
    },
    onSuccess: ({ family: saved }) => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ["admin", "product-families"] });
      toast.success("Family saved — product pages show it within a minute");
      if (isNew) router.replace(`${LIST}/${saved.id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Couldn't save — check the connection and try again"),
  });

  const remove = useMutation({
    mutationFn: () => familiesApi.deleteProductFamily(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "product-families"] });
      toast.success("Family deleted — the products are unchanged");
      router.replace(LIST);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't delete the family"),
  });

  if (ready && !allowed) return <PermissionState icon={Layers} page="Product families" />;

  function move(i: number, by: -1 | 1) {
    const next = [...members];
    const [m] = next.splice(i, 1);
    next.splice(i + by, 0, m!);
    setMembersDirty(next);
  }

  async function askDelete() {
    if (await confirm(`Delete “${name}”? Only the family goes; every product in it stays as it is.`, { title: "Delete this family?", confirmLabel: "Delete family" })) remove.mutate();
  }

  const canSave = name.trim().length > 0 && members.length >= 2 && dirty && !save.isPending;
  const full = members.length >= PRODUCT_FAMILY_MAX_MEMBERS;

  if (!isNew && family.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!isNew && family.error) {
    return (
      <div className="space-y-4">
        <BackLink href={LIST} label="Product families" />
        <EmptyState icon={Layers} title="Couldn't load this family" description={family.error instanceof ApiError ? family.error.message : "Check the connection and try again."} action={<Button onClick={() => void family.refetch()}>Try again</Button>} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href={LIST} label="Product families" />
      <PageHeader
        title={isNew ? "New family" : name || "Family"}
        description="Each product's page shows the family's other products as photo tiles, in this order. Products on sale only — unpublished ones stay listed here but hidden on the store."
        action={
          <span className="flex gap-2">
            {!isNew && (
              <Button variant="outline" onClick={() => void askDelete()} disabled={remove.isPending}>
                <Trash2 className="h-4 w-4" aria-hidden /> Delete
              </Button>
            )}
            <Button onClick={() => save.mutate()} disabled={!canSave} data-testid="family-save">
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </span>
        }
      />

      <Card>
        <CardContent className="space-y-5 p-5">
          <Field htmlFor="family-name" label="Family name" hint="Shown above the tiles on the product page, e.g. “Haven Collection” or “Choose a design”.">
            <Input id="family-name" name="family-name" autoComplete="off" value={name} maxLength={80} onChange={(e) => edit(setName)(e.target.value)} placeholder="Haven Collection…" />
          </Field>

          <div>
            <p className="mb-2 text-sm font-medium text-fg">Products ({members.length})</p>
            {members.length === 0 ? (
              <p className="rounded-xl bg-surface-muted px-4 py-6 text-center text-sm text-fg-muted">Add at least two products below.</p>
            ) : (
              <ol className="divide-y divide-line rounded-xl border border-line" data-testid="family-members">
                {members.map((m, i) => {
                  const status = STATUS[m.status] ?? { label: "Not on the store", variant: "warning" as const };
                  return (
                    <li key={m.productId} className="flex flex-wrap items-center gap-3 px-3 py-3 sm:flex-nowrap">
                      <span className="relative h-14 w-12 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
                        {m.imageUrl && <Image src={thumbnailUrl(m.imageUrl)} alt="" fill sizes="48px" className="object-cover" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 block text-sm font-medium text-fg">{m.name}</span>
                        <Badge variant={status.variant} className="mt-1">{status.label}</Badge>
                      </span>
                      <Input
                        aria-label={`Tile name for ${m.name}`}
                        value={m.label ?? ""}
                        maxLength={60}
                        placeholder="Tile name (optional)…"
                        autoComplete="off"
                        className="w-full sm:w-44"
                        onChange={(e) => setMembersDirty(members.map((x) => (x.productId === m.productId ? { ...x, label: e.target.value || null } : x)))}
                      />
                      <span className="flex shrink-0 gap-1">
                        <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${m.name} up`}>
                          <ArrowUp className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === members.length - 1} aria-label={`Move ${m.name} down`}>
                          <ArrowDown className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setMembersDirty(members.filter((x) => x.productId !== m.productId))} aria-label={`Remove ${m.name}`}>
                          <X className="h-4 w-4" aria-hidden />
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {full ? (
            <p className="text-sm text-fg-muted">A family holds up to {PRODUCT_FAMILY_MAX_MEMBERS} products.</p>
          ) : (
            <Field htmlFor="family-add" label="Add a product" hint="Search by name. A product can be in more than one family.">
              <ProductPicker
                selected={members.map((m) => ({ id: m.productId, name: m.name }))}
                onChange={() => undefined}
                onPick={(p) =>
                  setMembersDirty([
                    ...members,
                    { productId: p.id, name: p.name, slug: p.slug, status: p.deletedAt ? "TRASHED" : p.status, imageUrl: p.images[0]?.url ?? null, label: null },
                  ])
                }
              />
            </Field>
          )}

          {error && (
            <p role="alert" className="rounded-xl bg-danger-50 px-4 py-3 text-sm text-danger-700">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
      {confirmDialog}
    </div>
  );
}
