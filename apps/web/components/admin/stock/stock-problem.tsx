import { Alert } from "@/components/ui/alert";
import type { StockProblem } from "@/lib/api/stock";
import { formatPrice } from "@/lib/format";

/** A refused or failed entry: what happened and what to do. Not enough money shows the balance against what is needed. */
export function ProblemAlert({ problem }: { problem: StockProblem }) {
  return (
    <div role="alert" data-testid="stock-problem" data-code={problem.code ?? ""}>
      <Alert variant={problem.code === "STOCK_ENTRY_IN_PROGRESS" ? "warning" : "danger"} title={problem.title}>
        {problem.funds ? (
          <>
            <dl className="mt-1 grid max-w-xs grid-cols-[auto_auto] gap-x-6 gap-y-0.5 tabular-nums">
              <dt>In the account</dt><dd className="text-right">{formatPrice(problem.funds.balance)}</dd>
              <dt>This needs</dt><dd className="text-right font-semibold">{formatPrice(problem.funds.needed)}</dd>
            </dl>
            <p className="mt-1.5">Top it up, or pay from another account.</p>
          </>
        ) : (
          <p>{problem.detail}</p>
        )}
      </Alert>
    </div>
  );
}
