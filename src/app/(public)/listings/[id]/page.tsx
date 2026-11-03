// Stub. Owner: module lane 2 (Leasing) — public listing detail (photos, ask-about-this-unit, tour, apply).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="p-6"><h1 className="text-xl font-semibold">Listing {id}</h1></main>;
}
