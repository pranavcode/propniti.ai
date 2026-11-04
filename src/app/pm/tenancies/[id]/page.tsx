import { redirect } from "next/navigation";

// v1 route; v2 lives at /app/leases.
export default function Page() {
  redirect("/app/leases");
}
