import { toast } from "sonner";

// Success toast for a create or an action, with a "View" link to the record it touched when the
// person isn't already looking at it.
export function notifyDone(message: string, view?: { href: string; go: (href: string) => void }) {
  toast.success(message, view ? { action: { label: "View", onClick: () => view.go(view.href) } } : undefined);
}
