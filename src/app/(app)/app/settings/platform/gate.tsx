import { EmptyState } from "@/components/app/states";

// Settings → Platform is the SaaS operator's console; other roles get a pointer instead.
export function PlatformOnly() {
  return (
    <main className="p-6">
      <EmptyState kind="table" title="The platform console is for the SaaS operator" description="Customer orgs, usage and system health are visible to the platform admin role. Switch role from your avatar menu to see it." action={{ label: "Go to your home", href: "/app" }} />
    </main>
  );
}
