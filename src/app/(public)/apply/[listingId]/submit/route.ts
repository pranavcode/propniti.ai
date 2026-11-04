import { ApplyRequest } from "@/components/public/schemas";
import { publicWrite, submitApplication } from "@/components/public/writes";

// Submit an application: creates the applicant and application in the visitor's workspace and
// hands it to the Leasing Agent for scoring.
export async function POST(request: Request, { params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  return publicWrite(request, ApplyRequest, (ctx) => submitApplication(ctx, listingId));
}
