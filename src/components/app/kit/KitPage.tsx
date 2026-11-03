import { Palette } from "lucide-react";
import { PageBody, PageHeader, Section } from "../page";
import { KitTable } from "./KitTable";
import { queryUnits, UNIT_COLUMNS, UNIT_FACETS, UNIT_TABS } from "./sample";
import { FoundationsSection } from "./sections/FoundationsSection";

const INDEX = [
  ["foundations", "Foundations"],
  ["table", "DataTable"],
  ["states", "States"],
  ["onboarding", "Onboarding"],
] as const;

// /app/_kit: the living style guide. Every app component with realistic props.
export function KitPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const res = queryUnits(searchParams);
  return (
    <>
      <PageHeader
        icon={<Palette />}
        title="Component kit"
        description="The Propniti app design system: frame, tables, records, dashboards and AI surfaces, with sample data."
        meta={<>{INDEX.map(([id, label]) => <a key={id} href={`#${id}`} className="hover:text-foreground">{label}</a>)}</>}
      />
      <PageBody className="space-y-10">
        <FoundationsSection />
        <Section id="table" title="DataTable" description="Server-driven: URL state, status tabs with counts, facet chips, AI filter, saved views, column picker, density, export, sum footer, selection with bulk bar, J/K keys, virtualised over 100 rows.">
          <KitTable
            entity="units"
            label={{ one: "unit", many: "units" }}
            columns={UNIT_COLUMNS}
            statusTabs={UNIT_TABS}
            facets={UNIT_FACETS}
            rowHref="/app/units/{id}"
            exportHref="/api/e/units/export.csv"
            bulkActions={[{ key: "units.send_notice", label: "Send notice" }, { key: "units.assign", label: "Assign" }]}
            views={[{ key: "notice-austin", label: "Austin on notice", filters: { metro: "Austin", status: "Notice" }, builtIn: true }, { key: "owing", label: "Balance owed", filters: { "balance.min": "0.01" }, sort: ["balance", "desc"], builtIn: true }]}
            maxHeight="560px"
            {...res}
          />
        </Section>
      </PageBody>
    </>
  );
}
