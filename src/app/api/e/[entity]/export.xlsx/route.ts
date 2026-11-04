import { entityExport } from "@/extensions/export/routes";

// GET /api/e/[entity]/export.xlsx with the list's URL state; ?brand=0 drops the Propniti branding.
export async function GET(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  return entityExport(request, (await params).entity, "xlsx");
}
