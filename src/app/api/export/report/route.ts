import { reportExport } from "@/extensions/export/routes";

// GET ?r=<report>&format=csv|xlsx|pdf&brand=0|1 plus the report page's params.
export const GET = (request: Request) => reportExport(request);
