import { redirect } from "next/navigation";

// v1 route; v2 lives at /portal/resident.
export default function Page() {
  redirect("/portal/resident");
}
