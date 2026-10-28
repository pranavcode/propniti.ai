import { PropertyPage } from "@/components/views/DetailViews";

export default async function Page({ params }: PageProps<"/pm/properties/[id]">) {
  const { id } = await params;
  return <PropertyPage id={decodeURIComponent(id)} />;
}
