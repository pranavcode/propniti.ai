import { explainRoute } from "@/extensions/owners/explain";

// GET ?entity=&period=&line= — "Explain this line" for staff (links into the records).
export const GET = (request: Request) => explainRoute(request, "staff");
