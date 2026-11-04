import { toast } from "sonner";
import { closePeek } from "@/components/app/peek/usePeek";

// Success toast for a create or an action, with a "View" link to the record it touched when the
// person isn't already looking at it.
export function notifyDone(message: string, view?: { href: string; go: (href: string) => void }) {
  toast.success(message, view ? { action: { label: "View", onClick: () => view.go(view.href) } } : undefined);
}

// Leaves the peek drawer for a page. Closing the drawer can step history back (it pushed an
// entry when it opened), so navigate only once that Back has landed, or it would undo the move.
export function leavePeek(go: () => void) {
  const later = () => setTimeout(go, 0);
  window.addEventListener("popstate", later, { once: true });
  closePeek();
  if (!new URLSearchParams(window.location.search).has("peek")) {
    window.removeEventListener("popstate", later);
    go();
  }
}
