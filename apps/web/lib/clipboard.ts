import { toast } from "@/components/ui/toast";

/** One shared "Copy" action for every copy-to-clipboard button (phone, address, tracking number,
 * order ID, …) so the toast wording/timing is consistent instead of each call site rolling its own. */
export async function copyToClipboard(text: string, successMessage = "Copied to clipboard") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
  } catch {
    toast.error("Couldn't copy — please copy it manually");
  }
}
