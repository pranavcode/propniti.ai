import { TenancyPage } from "@/components/views/DetailViews";

export default async function Page({ params }: PageProps<"/pm/tenancies/[id]">) {
  const { id } = await params;
  return <TenancyPage id={decodeURIComponent(id)} />;
}
