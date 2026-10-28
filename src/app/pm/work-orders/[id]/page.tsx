import { WorkOrderPage } from "@/components/views/DetailViews";

export default async function Page({ params }: PageProps<"/pm/work-orders/[id]">) {
  const { id } = await params;
  return <WorkOrderPage id={decodeURIComponent(id)} />;
}
