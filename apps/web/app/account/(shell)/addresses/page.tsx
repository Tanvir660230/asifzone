"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus, Star, Trash2 } from "lucide-react";
import {
  createAddressSchema,
  BD_ALL_DISTRICTS,
  BD_DIVISION_BY_DISTRICT,
  BD_AREAS_BY_DISTRICT,
  BD_ALL_AREA_OPTIONS,
  parseAreaDistrictOption,
  type Address,
  type CreateAddressInput,
} from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal } from "@/components/ui/modal";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { AccountTitle } from "@/components/account/account-ui";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/empty-state";
import { AccountEmptyState } from "@/components/account/account-empty-state";
import * as customersApi from "@/lib/api/customers";
import { ApiError } from "@/lib/api-client";

export default function AccountAddressesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["my-addresses"], queryFn: customersApi.listAddresses });
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
      <AccountTitle
        title="Addresses"
        description="Where we deliver your orders. The default one is filled in at checkout."
        action={
          data && data.addresses.length > 0 ? (
            <Button onClick={() => setEditing("new")}>
              <Plus size={16} aria-hidden="true" /> Add address
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-busy="true">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState variant="bordered" title="Your addresses didn't load" onRetry={() => refetch()} />
      ) : data?.addresses.length === 0 ? (
        <AccountEmptyState
          icon={MapPin}
          title="No saved addresses yet"
          description="Add one and checkout fills it in for you next time."
          action={
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus size={16} aria-hidden="true" /> Add address
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {data?.addresses.map((address) => (
            <li key={address.id} className="flex flex-col rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-inset ring-line-subtle sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate font-semibold text-fg">{address.label || address.fullName}</p>
                  {address.isDefault && (
                    <Badge variant="neutral">
                      <Star size={11} fill="currentColor" aria-hidden="true" /> Default
                    </Badge>
                  )}
                </div>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-ink-600">
                {address.fullName}, {address.phone}
                <br />
                {address.addressLine}, {address.area}, {address.district}, {address.division}
              </p>
              <div className="mt-auto flex gap-2 pt-5">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditing(address)}
                  aria-label={`Edit the ${address.label || address.fullName} address`}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(address)}
                  aria-label={`Remove the ${address.label || address.fullName} address`}
                  className="text-fg-muted hover:text-danger-600"
                >
                  <Trash2 size={14} aria-hidden="true" /> Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

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
      : {
          division: "" as CreateAddressInput["division"],
          district: "",
          area: "",
          isDefault: false,
        },
  });

  const district = watch("district");
  const area = watch("area");
  // Until a district is chosen, offer every area/thana in the country (as "Area — District") so a
  // shopper who knows their thana but not its district can find it directly.
  const areaOptions: readonly string[] = district ? (BD_AREAS_BY_DISTRICT[district] ?? []) : BD_ALL_AREA_OPTIONS;

  function handleAreaChange(value: string) {
    const parsed = parseAreaDistrictOption(value);
    if (parsed) {
      setValue("district", parsed.district, { shouldValidate: true });
      setValue("area", parsed.area, { shouldValidate: true });
    } else {
      setValue("area", value, { shouldValidate: true });
    }
  }

  // Division is derived from the chosen district rather than picked separately — it's only needed
  // internally for the Dhaka/outside-Dhaka shipping-fee split, matching the checkout form.
  useEffect(() => {
    setValue("division", (BD_DIVISION_BY_DISTRICT[district] ?? "") as CreateAddressInput["division"]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [district]);

  // The area/thana list narrows to the selected district — clear it if it no longer applies. Only
  // relevant once a district is actually picked: with no district, areaOptions is the country-wide
  // combo list, which a plain area value would never match.
  useEffect(() => {
    if (!district) return;
    if (area && !areaOptions.includes(area)) {
      setValue("area", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [district]);

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
          {errors.fullName && <p className="ui-field-error">{errors.fullName.message}</p>}
        </div>
        <div>
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" placeholder="01XXXXXXXXX" {...register("phone")} />
          {errors.phone && <p className="ui-field-error">{errors.phone.message}</p>}
        </div>
      </div>
      <div>
        <Label htmlFor="district">District</Label>
        <SearchableSelect
          id="district"
          value={district}
          onChange={(v) => setValue("district", v, { shouldValidate: true })}
          options={BD_ALL_DISTRICTS}
          placeholder="Search district..."
        />
        {errors.district && <p className="ui-field-error">{errors.district.message}</p>}
      </div>
      <div>
        <Label htmlFor="area">Area / Thana</Label>
        <SearchableSelect
          id="area"
          value={area}
          onChange={handleAreaChange}
          options={areaOptions}
          placeholder={district ? "Search area/thana..." : "Search area/thana (any district)..."}
        />
        {errors.area && <p className="ui-field-error">{errors.area.message}</p>}
      </div>
      <div>
        <Label htmlFor="addressLine">House / Road / Details</Label>
        <Textarea id="addressLine" rows={2} {...register("addressLine")} />
        {errors.addressLine && <p className="ui-field-error">{errors.addressLine.message}</p>}
      </div>
      <label className="flex items-center gap-3 text-sm text-ink-700">
        <Checkbox {...register("isDefault")} />
        Set as default address
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          Save address
        </Button>
      </div>
    </form>
  );
}
