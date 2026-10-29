import { ReportIssueRequest } from "@/lib/requests";
import { reportIssue } from "@/server/actions";
import { write } from "@/server/route";

export async function POST(request: Request) {
  return write(request, ReportIssueRequest, (c) => reportIssue(c.db, c.ws, c.state, c.body.tenantId, c.body.text, c.nowMs));
}
