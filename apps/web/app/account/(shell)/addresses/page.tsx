"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Star, Trash2 } from "lucide-react";
import {
  createAddressSchema,
  BD_DIVISIONS,
  BD_DISTRICTS_BY_DIVISION,
  type Address,
  type CreateAddressInput,
} from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal } from "@/components/ui/modal";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import * as customersApi from "@/lib/api/customers";
import { ApiError } from "@/lib/api-client";

export default function AccountAddressesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["my-addresses"], queryFn: customersApi.listAddresses });
  const [editing, setEditing] = useState<Address | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const createMutation = useMutation({
    mutationFn: customersApi.createAddress,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-addresses"] });
      toast.success("Address added");
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateAddressInput }) => customersApi.updateAddress(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-addresses"] });
      toast.success("Address updated");
    },
  });
  const deleteMutation = useMutation({
    mutationFn: customersApi.deleteAddress,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-addresses"] });
      toast.success("Address removed");
    },
  });

  async function handleSubmit(values: CreateAddressInput) {
    setError(null);
    try {
      if (editing && editing !== "new") {
        await updateMutation.mutateAsync({ id: editing.id, input: values });
      } else {
        await createMutation.mutateAsync(values);
      }
      setEditing(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save address");
    }
  }

  async function handleDelete(address: Address) {
    if (!(await confirm(`Remove the "${address.label ?? address.fullName}" address?`))) return;
    await deleteMutation.mutateAsync(address.id);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl text-ink-900">Saved addresses</h1>
        <Button variant="brass" onClick={() => setEditing("new")}>
          <Plus size={16} /> Add address
        </Button>
      </div>

      {isLoading && <p className="text-ink-400">Loading…</p>}
      {!isLoading && data?.addresses.length === 0 && <p className="text-ink-400">No saved addresses yet.</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {data?.addresses.map((address) => (
          <div key={address.id} className="rounded-lg border border-ink-100 bg-cream-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-ink-900">{address.label || "Address"}</span>
                {address.isDefault && (
                  <span className="flex items-center gap-1 text-xs text-brass-600">
                    <Star size={12} fill="currentColor" /> Default
                  </span>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setEditing(address)} className="text-xs text-ink-500 hover:text-ink-900">
                  Edit
                </button>
                <button onClick={() => handleDelete(address)} className="text-ink-400 hover:text-danger-600">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <p className="text-sm text-ink-700">{address.fullName}</p>
            <p className="text-sm text-ink-500">{address.phone}</p>
            <p className="mt-1 text-sm text-ink-500">
              {address.addressLine}, {address.area}, {address.district}, {address.division}
            </p>
          </div>
        ))}
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add address" : "Edit address"}
      >
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {editing !== null && (
          <AddressForm
            initial={editing === "new" ? undefined : editing}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
      {confirmDialog}
    </div>
  );
}

function AddressForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Address;
  onSubmit: (values: CreateAddressInput) => Promise<void>;
  onCancel: () => void;
}) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateAddressInput>({
    resolver: zodResolver(createAddressSchema),
    defaultValues: initial
      ? {
          label: initial.label,
          fullName: initial.fullName,
          phone: initial.phone,
          division: initial.division as CreateAddressInput["division"],
          district: initial.district,
          area: initial.area,
          addressLine: initial.addressLine,
          isDefault: initial.isDefault,
        }
      : { division: BD_DIVISIONS[0], district: BD_DISTRICTS_BY_DIVISION[BD_DIVISIONS[0]][0], isDefault: false },
  });

  const division = watch("division") || BD_DIVISIONS[0];
  const district = watch("district");
  const districtOptions: readonly string[] = BD_DISTRICTS_BY_DIVISION[division] ?? [];

  // Courier-style cascading picker, matching the checkout form: narrow the district list to the
  // selected division and drop any district that no longer belongs to it.
  useEffect(() => {
    const firstDistrict = districtOptions[0];
    if (firstDistrict && !districtOptions.includes(district)) {
      setValue("district", firstDistrict);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [division]);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="label">Label (optional)</Label>
        <Input id="label" placeholder="Home, Office…" {...register("label")} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" {...register("fullName")} />
          {errors.fullName && <p className="mt-1 text-xs text-danger-600">{errors.fullName.message}</p>}
        </div>
        <div>
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" placeholder="01XXXXXXXXX" {...register("phone")} />
          {errors.phone && <p className="mt-1 text-xs text-danger-600">{errors.phone.message}</p>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="division">Division</Label>
          <Select id="division" {...register("division")}>
            {BD_DIVISIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="district">District</Label>
          <Select id="district" {...register("district")}>
            {districtOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
          {errors.district && <p className="mt-1 text-xs text-danger-600">{errors.district.message}</p>}
        </div>
      </div>
      <div>
        <Label htmlFor="area">Area / Thana</Label>
        <Input id="area" placeholder="e.g. Gulshan, Dhanmondi" {...register("area")} />
        {errors.area && <p className="mt-1 text-xs text-danger-600">{errors.area.message}</p>}
      </div>
      <div>
        <Label htmlFor="addressLine">House / Road / Details</Label>
        <Textarea id="addressLine" rows={2} {...register("addressLine")} />
        {errors.addressLine && <p className="mt-1 text-xs text-danger-600">{errors.addressLine.message}</p>}
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <Checkbox {...register("isDefault")} />
        Set as default address
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="brass" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save address"}
        </Button>
      </div>
    </form>
  );
}
