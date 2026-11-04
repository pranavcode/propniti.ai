import { TourRequest } from "@/components/public/schemas";
import { publicWrite, scheduleTour } from "@/components/public/writes";

// Book a tour: creates a prospect and a showing in the visitor's workspace.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return publicWrite(request, TourRequest, (ctx) => scheduleTour(ctx, id));
}
