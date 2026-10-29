import { LIST_PAGE_SIZES } from "@clothing-brand/shared";
import { Select } from "@/components/ui/select";

export function PageSizeSelect({ value, onChange, options = LIST_PAGE_SIZES }: { value: number; onChange: (size: number) => void; options?: readonly number[] }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink-500">
      Rows
      <Select value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-20">
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </Select>
    </label>
  );
}
