import { redirect } from "next/navigation";

// v1 route; v2 lives at /app/maintenance/work-orders.
export default function Page() {
  redirect("/app/maintenance/work-orders");
}
