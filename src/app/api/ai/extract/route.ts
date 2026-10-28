import { extractInvoice } from "@/lib/llm";
import { rateLimit } from "@/lib/guard";

const MAX_FILE_BYTES = 4 * 1024 * 1024;

// Identify the file by its first bytes, not the client-supplied type or name.
function sniff(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  if (String.fromCharCode(...b.slice(0, 5)) === "%PDF-") return "application/pdf";
  return null;
}

function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Uploaded documents are read and discarded; nothing is stored.
export async function POST(request: Request) {
  const limited = await rateLimit(request);
  if (limited) return limited;
  if (Number(request.headers.get("content-length") ?? 0) > MAX_FILE_BYTES + 64 * 1024) {
    return Response.json({ error: "File too large (max 4 MB)" }, { status: 413 });
  }
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return Response.json({ error: "Expected a multipart upload with a 'file' field" }, { status: 400 });
  }
  if (!(file instanceof File)) return Response.json({ error: "Expected a multipart upload with a 'file' field" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return Response.json({ error: "File too large (max 4 MB)" }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniff(bytes);
  if (!mime) return Response.json({ error: "Upload a JPEG, PNG, WebP or PDF" }, { status: 415 });
  return Response.json(await extractInvoice({ mime, base64: toBase64(bytes) }));
}
