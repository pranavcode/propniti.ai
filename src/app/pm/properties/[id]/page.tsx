import { redirect } from "next/navigation";

// v1 route; v2 property pages live at /app/properties/<id>.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/app/properties/${encodeURIComponent((await params).id)}`);
}
