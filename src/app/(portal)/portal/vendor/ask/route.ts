import { portalAskRoute } from "@/extensions/owners/portal/ask";
import { answerVendor } from "@/extensions/owners/portal/answers/vendor";

// POST { question } — the vendor's AI help, answered from their own jobs, invoices and payments.
export const POST = (request: Request) => portalAskRoute(request, "vendor", answerVendor);
