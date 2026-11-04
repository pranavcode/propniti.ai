import { redirect } from "next/navigation";

// The automations that really run (agents, the sweep, approval rules) live on /app/automations.
export default function Page() {
  redirect("/app/automations");
}
