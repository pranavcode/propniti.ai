import { redirect } from "next/navigation";

// v1 route; v2 lives at /login.
export default function Page() {
  redirect("/login");
}
