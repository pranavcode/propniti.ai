import { statementExport } from "@/extensions/export/routes";

// GET ?entity=&period=&format=csv|xlsx|pdf&brand=0|1, for staff and the owner portal.
export const GET = (request: Request) => statementExport(request);
