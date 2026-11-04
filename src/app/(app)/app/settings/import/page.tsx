import type { Metadata } from "next";
import { Upload } from "lucide-react";
import { can } from "@/entities";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { effective } from "@/server/query";
import { PageBody, PageHeader } from "@/components/app/page";
import { ImportWizard, type ImportOptions } from "./ImportWizard";

export const metadata: Metadata = { title: "Import data · Propniti" };

export default async function ImportPage() {
  const session = await currentSession();
  const db = getPlatform().db;
  const ws = session.ws;
  const scope = session.actor.propertyIds;
  const [portfolios, regions, props] = await Promise.all([
    db.prepare(`SELECT p.id, p.name, p.owner_entity_id, coalesce(o.name, p.owner_entity_id) AS owner FROM ${effective("portfolios", ws)} p LEFT JOIN ${effective("owner_entities", ws)} o ON o.id = p.owner_entity_id ORDER BY o.name, p.name LIMIT 100`).all<{ id: string; name: string; owner_entity_id: string; owner: string }>(),
    db.prepare(`SELECT id, name, states FROM ${effective("regions", ws)} ORDER BY name`).all<{ id: string; name: string; states: string }>(),
    db.prepare(`SELECT id, name, street FROM ${effective("properties", ws)} ${scope === "all" ? "" : "WHERE id IN (SELECT value FROM json_each(?))"} ORDER BY name LIMIT 500`).bind(...(scope === "all" ? [] : [JSON.stringify(scope)])).all<{ id: string; name: string; street: string }>(),
  ]);
  const options: ImportOptions = {
    canCreateProperties: can(session.actor.role, "create", "properties"),
    canCreateUnits: can(session.actor.role, "create", "units"),
    // SQLite rows have a null prototype; copy them into plain objects for the client.
    portfolios: portfolios.results.map((p) => ({ id: p.id, name: p.name, owner_entity_id: p.owner_entity_id, owner: p.owner })),
    regions: regions.results.map((r) => ({ id: r.id, name: r.name, states: (() => { try { return JSON.parse(r.states) as string[]; } catch { return []; } })() })),
    existing: props.results.map((p) => ({ id: p.id, name: p.name, street: p.street })),
  };
  return (
    <>
      <PageHeader icon={<Upload />} title="Import properties and units" description="Bring a rent roll from AppFolio, Buildium, Yardi or a spreadsheet. Columns are matched for you, every value is checked, and nothing is written until you confirm the preview." />
      <PageBody>
        <ImportWizard options={options} />
      </PageBody>
    </>
  );
}
