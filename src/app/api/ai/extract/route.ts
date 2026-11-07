import { extractCoi, extractInsurance, extractInvoice } from "@/lib/llm";
import { rateLimit, readBodyLimited } from "@/lib/guard";
import { sameOrigin } from "@/ai/session";
import { MAX_UPLOAD_BYTES as MAX_FILE_BYTES, sniff } from "@/lib/upload";

function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Uploaded documents are read and discarded; nothing is stored.
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const limited = await rateLimit(request);
  if (limited) return limited;
  // Cap the whole multipart body while streaming, then parse it from memory.
  const body = await readBodyLimited(request, MAX_FILE_BYTES + 64 * 1024);
  if (body instanceof Response) return Response.json({ error: "File too large (max 4 MB)" }, { status: 413 });
  let file: FormDataEntryValue | null;
  let kind: FormDataEntryValue | null;
  try {
    const form = await new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
    file = form.get("file");
    kind = form.get("kind");
  } catch {
    return Response.json({ error: "Expected a multipart upload with a 'file' field" }, { status: 400 });
  }
  if (!(file instanceof File)) return Response.json({ error: "Expected a multipart upload with a 'file' field" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return Response.json({ error: "File too large (max 4 MB)" }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniff(bytes);
  if (!mime) return Response.json({ error: "Upload a JPEG, PNG, WebP or PDF" }, { status: 415 });
  // kind=coi reads a vendor certificate of insurance; kind=insurance reads a renters insurance
  // declarations page; anything else reads an invoice.
  const doc = { mime, base64: toBase64(bytes) };
  return Response.json(kind === "coi" ? await extractCoi(doc) : kind === "insurance" ? await extractInsurance(doc) : await extractInvoice(doc));
}
