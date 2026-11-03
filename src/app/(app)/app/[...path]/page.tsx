import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { allEntities, getEntityByRoute } from "@/entities";
import { currentSession, requireStaff } from "@/auth/session";
import { ListView, ModuleIndex, RecordView } from "@/components/entity/pages";
import { PageSkeleton } from "@/components/app/PageSkeleton";

// Generic entity pages (lane C). Any /app path without a static route lands here and resolves
// through the registry:
//   EntityDef.route            → list          (?new=1 opens the New sheet)
//   route/<id>                 → record        (?tab=<key>, ?edit=1 opens the Edit sheet)
//   route/new, route/<id>/edit → redirect to the sheet forms above
//   a prefix of entity routes  → module index  (/app/maintenance: KPIs, charts, main lists)
// Static routes win (plan §4, extension point 1).

type Props = { params: Promise<{ path: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const toParams = (sp: Record<string, string | string[] | undefined>) => {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const x of Array.isArray(v) ? v : v == null ? [] : [v]) out.append(k, x);
  return out;
};

function resolve(segments: string[]) {
  const path = "/app/" + segments.map(decodeURIComponent).join("/");
  const last = segments[segments.length - 1];
  if (last === "new") {
    const hit = getEntityByRoute(path.slice(0, -4));
    if (hit && !hit.id) return { redirect: `${hit.def.route}?new=1` };
  }
  if (last === "edit") {
    const hit = getEntityByRoute(path.slice(0, -5));
    if (hit?.id) return { redirect: `${hit.def.route}/${encodeURIComponent(hit.id)}?edit=1` };
  }
  return { path, hit: getEntityByRoute(path) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { path } = await params;
  const r = resolve(path);
  if (!("hit" in r) || !r.hit) return { title: "Propniti" };
  return { title: `${r.hit.id ? `${r.hit.def.label.one} ${r.hit.id}` : r.hit.def.label.many} · Propniti` };
}

// Unknown paths 404 here, before the Suspense boundary starts the stream (which fixes the status at
// 200); the page body loads behind the skeleton.
export default async function EntityPage({ params, searchParams }: Props) {
  const { path } = await params;
  const r = resolve(path);
  if (r.redirect) redirect(r.redirect);
  const hit = r.hit;
  if (!hit && !allEntities().some((d) => d.route.startsWith(r.path! + "/"))) notFound();
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EntityBody hit={hit} path={r.path!} searchParams={searchParams} />
    </Suspense>
  );
}

async function EntityBody({ hit, path, searchParams }: { hit: ReturnType<typeof getEntityByRoute>; path: string; searchParams: Props["searchParams"] }) {
  await requireStaff();
  const sp = toParams(await searchParams);
  const session = await currentSession();
  if (hit && !hit.id) return <ListView def={hit.def} searchParams={sp} session={session} />;
  if (hit?.id) return <RecordView def={hit.def} id={hit.id} searchParams={sp} session={session} />;
  return <ModuleIndex path={path} session={session} />;
}
