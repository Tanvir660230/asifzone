"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Waypoints } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { AccountMapping, ChartAccount, LedgerAccountType } from "@/lib/api/finance";
import { PermissionState } from "@/components/admin/permission-state";

/** A mapping key's prefix: what the section is called and the account type the API requires (chart.service EXPECTED_TYPE). */
const SECTIONS: Array<{ prefix: string; title: string; type: LedgerAccountType }> = [
  { prefix: "revenue", title: "Sales", type: "REVENUE" },
  { prefix: "cogs", title: "Cost of goods", type: "COGS" },
  { prefix: "expense", title: "Costs", type: "EXPENSE" },
  { prefix: "income", title: "Other income", type: "OTHER_INCOME" },
  { prefix: "asset", title: "Things you own", type: "ASSET" },
  { prefix: "liability", title: "What you owe", type: "LIABILITY" },
  { prefix: "equity", title: "Owners' equity", type: "EQUITY" },
  { prefix: "clearing", title: "Money on its way (couriers & gateways)", type: "ASSET" },
  { prefix: "group", title: "Where new money accounts are filed", type: "ASSET" },
];
const humanise = (key: string) => {
  const rest = key.split(".").slice(1).join(" ").replace(/_/g, " ");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
};

/**
 * Account mapping (docs/FINANCE_PHASE_1.md §3): every automatic posting — a sale, a courier fee, a supplier bill — goes to
 * the account its mapping names. The defaults come with the chart; the owner can point a mapping at another account of
 * the right type. Changes apply to postings from now on, never to what's already posted.
 */
export default function AccountMappingPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("finance.view");
  const mappings = useQuery({ queryKey: financeApi.mappingKeys.all, queryFn: financeApi.listMappings, enabled: allowed });
  const chart = useQuery({ queryKey: financeApi.ledgerKeys.chart(), queryFn: financeApi.listChart, enabled: allowed });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <PermissionState icon={Waypoints} page="Account mapping" />
      </div>
    );
  }
  const all = mappings.data?.mappings ?? [];
  const unmapped = all.filter((m) => !m.account).length;
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Account mapping"
        description="Which account in the books each automatic entry uses — sales, cost of goods, courier fees, supplier bills. The defaults work for most shops; change one only if your accountant asks."
      />
      {mappings.isLoading || chart.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : mappings.isError || chart.isError ? (
        <Alert variant="danger" title="Mappings couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => { void mappings.refetch(); void chart.refetch(); }}>Retry</Button>}>
          {getErrorMessage(mappings.error ?? chart.error, "")}
        </Alert>
      ) : (
        <>
          {unmapped > 0 && <Alert variant="warning" title={`${unmapped} mapping(s) have no account`}>Entries that need them will wait until an account is chosen.</Alert>}
          {SECTIONS.map((sec) => {
            const rows = all.filter((m) => m.key.split(".")[0] === sec.prefix);
            if (!rows.length) return null;
            return (
              <section key={sec.prefix} aria-labelledby={`map-${sec.prefix}`}>
                <h2 id={`map-${sec.prefix}`} className="mb-2 text-[15px] font-semibold text-fg">{sec.title}</h2>
                <Card className="divide-y divide-line-subtle p-0">
                  {rows.map((m) => <MappingRow key={m.key} mapping={m} type={sec.type} isGroup={sec.prefix === "group"} accounts={chart.data?.accounts ?? []} canEdit={can("finance.configure")} />)}
                </Card>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

function MappingRow({ mapping, type, isGroup, accounts, canEdit }: { mapping: AccountMapping; type: LedgerAccountType; isGroup: boolean; accounts: ChartAccount[]; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(mapping.account?.id ?? "");
  const choices = accounts.filter((a) => a.isActive && a.type === type && a.isPostable !== isGroup);
  const save = useMutation({
    mutationFn: () => financeApi.setMapping(mapping.key, value, "Changed on the Account mapping page"),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: financeApi.mappingKeys.all }); void queryClient.invalidateQueries({ queryKey: financeApi.ledgerKeys.chart() }); toast.success(`${humanise(mapping.key)} now posts to the chosen account`); },
    onError: (err) => { setValue(mapping.account?.id ?? ""); toast.error(getErrorMessage(err, "The mapping couldn't be changed")); },
  });
  const dirty = value !== (mapping.account?.id ?? "");
  return (
    <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4" data-testid={`mapping-${mapping.key}`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-fg">{humanise(mapping.key)}</p>
        <p className="font-mono text-xs text-fg-subtle">{mapping.key}</p>
      </div>
      {canEdit ? (
        <div className="flex items-center gap-2 sm:w-[26rem]">
          <Select aria-label={`Account for ${humanise(mapping.key)}`} value={value} onChange={(e) => setValue(e.target.value)} className="min-w-0 flex-1">
            {!mapping.account && <option value="">Not mapped</option>}
            {choices.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </Select>
          {dirty && <Button size="sm" loading={save.isPending} disabled={!value} onClick={() => save.mutate()}>Save</Button>}
        </div>
      ) : mapping.account ? (
        <p className="text-sm text-fg sm:w-[26rem]">{mapping.account.code} · {mapping.account.name}</p>
      ) : (
        <Badge variant="warning">Not mapped</Badge>
      )}
    </div>
  );
}
