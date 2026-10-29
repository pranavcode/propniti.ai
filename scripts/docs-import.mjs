#!/usr/bin/env node
// Converts a Claude Docs tab (the XML returned by a full Claude Docs `read` of the tab's body node)
// into content/docs/<slug>.md, and copies its images into public/docs/<slug>/.
//
//   node scripts/docs-import.mjs <manifest.json>
//
// manifest.json:
//   {
//     "slug": "walkthrough",
//     "xml": "/tmp/walkthrough.xml",
//     "media": { "<blob id>": "/tmp/screens/<asset>.png" },   // <media blob='blob/<id>'> images
//     "embeds": { "<node id>": "/tmp/svg/<name>.svg" },       // <embed ref='node/<id>'> diagrams, pre-rendered
//     "drop": ["User p"],                                      // paragraphs to skip, by exact text
//     "crossLinks": [["Solution Architecture document", "/docs/architecture"]]  // prose that names another doc
//   }
//
// The H1 title and the date/author byline are dropped: the page renders its own title and snapshot line.
// Links to "#<block id>" become "#<heading slug>", using the same slug rules as src/lib/docs.ts.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Same rules as slugify() in src/lib/docs.ts (a test checks every anchor resolves).
const slugify = (s) =>
  s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/[\s-]+/g, "-");

const decode = (s) =>
  s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" })[e]);

// Minimal parser for the Claude Docs XML: single-quoted attributes, no CDATA or processing instructions.
function parse(xml) {
  const top = { tag: "#root", attrs: {}, children: [] };
  const stack = [top];
  let session = "";
  const re = /<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z-]+='[^']*')*)\s*(\/?)>|([^<]+)/g;
  for (let m; (m = re.exec(xml)); ) {
    const [, close, tag, rawAttrs, selfClose, text] = m;
    const parent = stack[stack.length - 1];
    if (text !== undefined) {
      parent.children.push({ text: decode(text) });
      continue;
    }
    if (close) {
      if (stack.pop().tag !== tag) throw new Error(`mismatched </${tag}>`);
      continue;
    }
    const attrs = {};
    for (const [, k, v] of rawAttrs.matchAll(/([a-zA-Z-]+)='([^']*)'/g)) attrs[k] = decode(v);
    // Ids are printed short (".123") after the first full id ("abc.0") of their session.
    if (attrs.id?.includes(".")) {
      if (attrs.id.startsWith(".")) attrs.id = session + attrs.id;
      else session = attrs.id.split(".")[0];
    }
    const node = { tag, attrs, children: [] };
    parent.children.push(node);
    if (!selfClose) stack.push(node);
  }
  return top.children.find((n) => n.tag === "doc");
}

const plain = (n) => (n.text !== undefined ? n.text : n.tag === "comment" ? "" : n.children.map(plain).join(""));

// Escape text so markdown shows it literally.
const esc = (s) => s.replace(/[\\`*_[\]<>|~]/g, "\\$&").replace(/&(?=[a-zA-Z#0-9]+;)/g, "&amp;");

// Flatten a paragraph into runs of { text, marks }, merging neighbours with the same marks.
function runs(node, marks = {}, out = []) {
  for (const c of node.children) {
    if (c.text !== undefined) {
      const last = out[out.length - 1];
      if (last && JSON.stringify(last.marks) === JSON.stringify(marks)) last.text += c.text;
      else out.push({ text: c.text, marks });
    } else if (c.tag === "bold" || c.tag === "italic" || c.tag === "code") runs(c, { ...marks, [c.tag]: true }, out);
    else if (c.tag === "link") runs(c, { ...marks, link: c.attrs.href }, out);
    else if (c.tag === "text") runs(c, marks, out);
    else if (c.tag === "mention") out.push({ text: `@${c.attrs.name}`, marks });
    else if (c.tag === "date") out.push({ text: c.attrs.value, marks });
  }
  return out;
}

const ORDER = ["link", "bold", "italic", "code"];
const has = (r, k, v) => (k === "link" ? r.marks.link === v : r.marks[k]);

// Render runs, opening each mark once over the longest stretch that carries it (link, bold, italic, code).
function inline(rs, resolveHref) {
  let out = "";
  for (let i = 0; i < rs.length; ) {
    const k = ORDER.find((m) => rs[i].marks[m]);
    if (!k) {
      out += esc(rs[i].text);
      i++;
      continue;
    }
    const v = rs[i].marks[k];
    let j = i;
    while (j < rs.length && has(rs[j], k, v)) j++;
    const inner = rs.slice(i, j).map((r) => ({ text: r.text, marks: { ...r.marks, [k]: undefined } }));
    const body = k === "code" ? rs.slice(i, j).map((r) => r.text).join("") : inline(inner, resolveHref);
    // Emphasis can't start or end with a space: move edge whitespace outside the markers.
    const [, lead, core, trail] = body.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!core) out += body;
    else if (k === "code") out += `${lead}${core.includes("`") ? "`` " + core + " ``" : "`" + core + "`"}${trail}`;
    else if (k === "link") out += `${lead}[${core}](${resolveHref(v)})${trail}`;
    else out += `${lead}${k === "bold" ? "**" : "*"}${core}${k === "bold" ? "**" : "*"}${trail}`;
    i = j;
  }
  return out;
}

// Screenshots are resized to 1600px wide WebP so pages stay light; returns the new [width, height].
const webReady = (file, out) =>
  execFileSync(
    process.execPath,
    ["-e", 'require("sharp")(process.argv[1]).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 80 }).toFile(process.argv[2]).then((i) => console.log(i.width, i.height))', file, out],
    { cwd: root, encoding: "utf8" },
  ).trim().split(" ").map(Number);
const svgSize = (file) => {
  const m = readFileSync(file, "utf8").match(/<svg[^>]*\swidth="(\d+)"[^>]*\sheight="(\d+)"/);
  if (!m) throw new Error(`${file}: svg needs width and height`);
  return [Number(m[1]), Number(m[2])];
};

function convert(manifest) {
  const { slug } = manifest;
  const doc = parse(readFileSync(manifest.xml, "utf8"));
  const drop = new Set(manifest.drop ?? []);
  const outDir = join(root, "public/docs", slug);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // Heading slugs, deduplicated in document order like the renderer (the H1 is not rendered).
  const anchors = new Map();
  const seen = new Map();
  for (const n of doc.children) {
    if (n.tag !== "paragraph" || !n.attrs.heading || n.attrs.heading === "1") continue;
    const base = slugify(plain(n));
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.set(n.attrs.id, count ? `${base}-${count}` : base);
  }
  const resolveHref = (href) => {
    if (!href.startsWith("#")) return href;
    const a = anchors.get(href.slice(1));
    if (!a) throw new Error(`${slug}: link ${href} does not point at a heading`);
    return `#${a}`;
  };

  let imageNo = 0;
  const image = (alt, src, [w, h]) => `![${esc(alt)}](${src}#${w}x${h})`;
  const media = (m) => {
    const blob = m.attrs.blob.replace(/^blob\//, "");
    const file = manifest.media?.[blob];
    if (!file) throw new Error(`${slug}: no file for media ${blob}`);
    imageNo++;
    const name = `${String(imageNo).padStart(2, "0")}-${slugify(m.attrs.alt ?? "image").split("-").slice(0, 6).join("-")}.webp`;
    return image(m.attrs.alt ?? "", `/docs/${slug}/${name}`, webReady(file, join(outDir, name)));
  };
  const embed = (e) => {
    const node = e.attrs.ref.replace(/^node\//, "");
    const file = manifest.embeds?.[node];
    if (!file) throw new Error(`${slug}: no rendered file for embed ${node}`);
    const name = basename(file).replace(new RegExp(`^${slug}-`), "");
    copyFileSync(file, join(outDir, name));
    const label = readFileSync(file, "utf8").match(/aria-label="([^"]*)"/)?.[1] ?? e.attrs.caption ?? "";
    return image(decode(label), `/docs/${slug}/${name}`, svgSize(file));
  };

  const para = (p, heading = false) => {
    const parts = [];
    let rs = [];
    const flush = () => {
      if (rs.length) parts.push(inline(rs, resolveHref));
      rs = [];
    };
    for (const c of p.children) {
      if (c.tag === "media") {
        flush();
        parts.push(media(c));
      } else rs.push(...runs({ children: [c] }));
    }
    flush();
    const md = parts.join(" ").trim();
    // Text that would read as a block marker at the start of a line (harmless inside a heading).
    return heading ? md : md.replace(/^(\d+)([.)])(\s)/, "$1\\$2$3").replace(/^([#+=-])/, "\\$1");
  };

  const blocks = [];
  for (const n of doc.children) {
    if (n.tag === "paragraph") {
      const text = plain(n).trim();
      if (n.attrs.heading === "1" || drop.has(text)) continue;
      const isByline = n.children.some((c) => c.tag === "date" || c.tag === "mention") && !n.children.some((c) => c.tag === "text" && plain(c).trim().replace("·", ""));
      if (isByline) continue;
      if (n.attrs.heading) {
        blocks.push(`${"#".repeat(Number(n.attrs.heading))} ${para(n, true)}`);
        continue;
      }
      const md = para(n);
      if (md) blocks.push(md);
    } else if (n.tag === "list") {
      const items = n.children.filter((c) => c.tag === "listItem");
      const start = Number(n.attrs.start ?? 1);
      blocks.push(
        items
          .map((item, i) => {
            const marker =
              n.attrs.kind === "ordered" ? `${start + i}.` : n.attrs.kind === "check" ? `- [${item.attrs.checked === "true" ? "x" : " "}]` : "-";
            const indent = " ".repeat(n.attrs.kind === "ordered" ? marker.length + 1 : 2);
            const paras = item.children.filter((c) => c.tag === "paragraph").map(para);
            return `${marker} ${paras.join(`\n\n${indent}`)}`;
          })
          .join("\n"),
      );
    } else if (n.tag === "table") {
      const rows = n.children.filter((c) => c.tag === "row").map((r) =>
        r.children.filter((c) => c.tag === "cell").map((cell) =>
          cell.children.filter((c) => c.tag === "paragraph").map(para).filter(Boolean).join("<br>"),
        ),
      );
      const line = (cells) => `| ${cells.join(" | ")} |`;
      blocks.push([line(rows[0]), line(rows[0].map(() => "---")), ...rows.slice(1).map(line)].join("\n"));
    } else if (n.tag === "embed") {
      blocks.push(embed(n));
    }
  }

  // The one place a doc names another doc in prose: make it a link.
  let md = blocks.join("\n\n") + "\n";
  for (const [phrase, href] of manifest.crossLinks ?? []) md = md.replace(phrase, `[${phrase}](${href})`);

  mkdirSync(join(root, "content/docs"), { recursive: true });
  writeFileSync(join(root, "content/docs", `${slug}.md`), md);
  const headings = { h2: (md.match(/^## /gm) ?? []).length, h3: (md.match(/^### /gm) ?? []).length };
  console.log(`${slug}: ${md.length} chars, ${imageNo} images, ${Object.keys(manifest.embeds ?? {}).length} diagrams, headings`, headings);
}

for (const file of process.argv.slice(2)) convert(JSON.parse(readFileSync(file, "utf8")));
