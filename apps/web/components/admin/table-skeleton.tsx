export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-t border-ink-100">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <div className="h-4 animate-pulse rounded bg-ink-100" style={{ width: c === 0 ? "70%" : "50%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
