import { explainRoute } from "@/extensions/owners/explain";

// GET ?entity=&period=&line= — "Explain this line" for the owner's own statements (no staff links).
export const GET = (request: Request) => explainRoute(request, "owner");
