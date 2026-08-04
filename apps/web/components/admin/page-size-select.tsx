import { Select } from "@/components/ui/select";

const OPTIONS = [10, 20, 50];

export function PageSizeSelect({ value, onChange }: { value: number; onChange: (size: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink-500">
      Rows
      <Select value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-20">
        {OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </Select>
    </label>
  );
}
