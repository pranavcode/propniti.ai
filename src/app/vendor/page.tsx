import { redirect } from "next/navigation";

// v1 route; v2 lives at /portal/vendor.
export default function Page() {
  redirect("/portal/vendor");
}
