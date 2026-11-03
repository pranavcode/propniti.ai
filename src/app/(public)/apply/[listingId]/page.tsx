// Stub. Owner: module lane 2 (Leasing) — application form; creates applicant + application in the visitor's workspace.
export default async function Page({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  return <main className="p-6"><h1 className="text-xl font-semibold">Apply for {listingId}</h1></main>;
}
