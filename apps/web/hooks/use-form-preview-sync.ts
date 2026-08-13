import { useEffect } from "react";
import type { UseFormWatch } from "react-hook-form";

/** Mirrors a react-hook-form instance's live values out to a parent (e.g. an in-modal preview
 * panel) without subscribing the form itself to re-render on every keystroke — `watch(callback)`
 * fires the callback on change but doesn't touch this component's own render cycle. */
export function useFormPreviewSync<T extends Record<string, unknown>>(
  watch: UseFormWatch<T>,
  onValuesChange?: (values: T) => void,
) {
  useEffect(() => {
    if (!onValuesChange) return;
    onValuesChange(watch());
    const subscription = watch((value) => onValuesChange(value as T));
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch]);
}
