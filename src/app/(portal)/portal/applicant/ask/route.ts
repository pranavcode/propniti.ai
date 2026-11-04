import { portalAskRoute } from "@/extensions/owners/portal/ask";
import { answerApplicant } from "@/extensions/owners/portal/answers/applicant";

// POST { question } — the applicant's AI help, answered from their own application.
export const POST = (request: Request) => portalAskRoute(request, "applicant", answerApplicant);
