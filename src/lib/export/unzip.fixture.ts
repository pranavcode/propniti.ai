import { crc32 } from "./zip";

// Reads a ZIP back (central directory → inflate → CRC check), so the tests see what Excel would.
export async function unzip(buf: Uint8Array): Promise<Record<string, string>> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let end = buf.length - 22;
  while (v.getUint32(end, true) !== 0x06054b50) end--;
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const out: Record<string, string> = {};
  for (let k = 0; k < count; k++) {
    if (v.getUint32(at, true) !== 0x02014b50) throw new Error("bad central directory entry");
    const method = v.getUint16(at + 10, true);
    const crc = v.getUint32(at + 16, true);
    const csize = v.getUint32(at + 20, true);
    const nlen = v.getUint16(at + 28, true);
    const off = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(buf.subarray(at + 46, at + 46 + nlen));
    if (v.getUint32(off, true) !== 0x04034b50) throw new Error("bad local header");
    const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    const raw = buf.subarray(start, start + csize);
    const data = method === 8 ? new Uint8Array(await new Response(new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()) : raw;
    if (crc32(data) !== crc) throw new Error(`CRC mismatch in ${name}`);
    out[name] = name.endsWith(".png") ? `png:${data.length}` : new TextDecoder().decode(data);
    at += 46 + nlen + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
  }
  return out;
}
