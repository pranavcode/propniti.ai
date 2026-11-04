import { portalAskRoute } from "@/extensions/owners/portal/ask";
import { answerOwner } from "@/extensions/owners/portal/answers/owner";

// POST { question } — the owner's AI Q&A, answered from their own statements and properties.
export const POST = (request: Request) => portalAskRoute(request, "owner", answerOwner);
