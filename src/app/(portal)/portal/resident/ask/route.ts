import { portalAskRoute } from "@/extensions/owners/portal/ask";
import { answerResident } from "@/extensions/owners/portal/answers/resident";

// POST { question } — the resident's AI help, answered from their own lease, ledger and requests.
export const POST = (request: Request) => portalAskRoute(request, "resident", answerResident);
