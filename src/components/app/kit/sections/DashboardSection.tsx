"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartCard, DashboardGrid, GridItem, KpiCard, KpiRow } from "../../dashboard";
import { Section } from "../../page";

// Sample portfolio figures (30 properties, Nov 2026) for the dashboard kit.
const MONTHS = ["Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"];
const NOI = [1_182_400, 1_164_900, 1_201_300, 1_236_800, 1_228_100, 1_259_600, 1_281_200, 1_274_500, 1_302_900, 1_296_400, 1_318_700, 1_241_600];
const noiT12 = MONTHS.map((m, i) => ({ month: m, noi: NOI[i]!, budget: 1_215_000 + i * 9_000 }));
const occupancy = MONTHS.map((m, i) => ({ month: m, physical: 0.936 + Math.sin(i / 2) * 0.008 + i * 0.0012, economic: 0.902 + Math.sin(i / 2.4) * 0.01 + i * 0.001 }));
const aging = ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"].map((m, i) => ({ month: m, d0_30: 182_400 + i * 4_100, d31_60: 64_800 + (i % 3) * 7_200, d61_90: 28_300 + i * 1_900, d90: 41_700 + i * 3_400 }));
const byProperty = [
  ["Uptown Tower at McKinney", 214_300], ["Midtown Peachtree", 188_900], ["The Lofts at Riverside", 161_200], ["Barton Creek Commons", 142_800], ["Lakewood Gardens", 121_400], ["Bishop Arts Flats", 98_700], ["Mueller Park Residences", 91_300], ["Cedar Hollow Townhomes", 64_900],
].map(([name, noi], i) => ({ property: name as string, property_id: `p${String(i + 1).padStart(2, "0")}`, noi: noi as number }));
const funnel = [["Leads", 1_284], ["Tours", 512], ["Applications", 231], ["Approved", 176], ["Leases signed", 149]].map(([stage, n]) => ({ stage: stage as string, n: n as number }));
const collections = [["Collected on time", 1_986_400], ["Collected late", 142_300], ["Payment plan", 38_900], ["Outstanding", 96_200]].map(([status, amount]) => ({ status: status as string, amount: amount as number }));
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = ["6a", "8a", "10a", "12p", "2p", "4p", "6p", "8p", "10p"];
const heat = DAYS.flatMap((d, di) => HOURS.map((h, hi) => ({ day: d, hour: h, wos: Math.max(0, Math.round((di < 5 ? 9 : 5) * Math.exp(-((hi - 3.5) ** 2) / 6) + ((di * 7 + hi * 3) % 5) - 1)) })));

const explain = <Button size="xs" variant="ghost" className="text-tone-ai hover:bg-tone-ai/10 hover:text-tone-ai"><Sparkles /> Explain</Button>;

export function DashboardSection() {
  return (
    <Section id="dashboard" title="Dashboard kit" description="KpiCard (delta coloured by good direction, sparkline, drill link), ChartCard in every kind with click-through drills, lazy client-only Recharts, skeletons and empty states, and the responsive grid.">
      <div className="space-y-3">
        <KpiRow>
          <KpiCard label="NOI, month to date" value={1_241_600} previous={1_318_700} format="money" spark={NOI} href="/app/reports?r=noi" help="Net operating income: rent and other income minus operating expenses, before debt service." footnote="vs $1.27M budget" />
          <KpiCard label="Physical occupancy" value={0.951} previous={0.946} format="pct" spark={occupancy.map((o) => o.physical)} href="/app/units?f.status=Vacant" />
          <KpiCard label="Delinquency 30+ days" value={134_800} previous={118_300} format="money" goodWhen="down" spark={aging.map((a) => a.d31_60 + a.d61_90 + a.d90)} href="/app/receivables/delinquency" />
          <KpiCard label="Work orders past SLA" value={17} previous={23} format="count" goodWhen="down" spark={[31, 28, 26, 29, 24, 23, 17]} href="/app/maintenance/work-orders?view=past-sla" />
          <KpiCard label="Avg days on market" value={21} previous={24} format="days" goodWhen="down" spark={[29, 27, 26, 24, 24, 21]} />
          <KpiCard label="Loading" value={null} loading />
        </KpiRow>

        <DashboardGrid>
          <GridItem span={8}>
            <ChartCard title="NOI, trailing 12 months" description="All 30 properties · actual vs budget" kind="area" data={noiT12} x="month" series={[{ key: "noi", label: "NOI", format: "money" }]} drill="/app/reports?r=noi&month={month}" actions={explain} height={220} />
          </GridItem>
          <GridItem span={4}>
            <ChartCard title="Rent collected, October" description="$2.26M scheduled" kind="donut" data={collections} x="status" series={[{ key: "amount", label: "Scheduled", format: "money" }]} drill="/app/receivables/payments?f.bucket={status}" height={168} />
          </GridItem>
          <GridItem span={6}>
            <ChartCard title="Occupancy trend" description="Physical vs economic" kind="line" data={occupancy} x="month" series={[{ key: "physical", label: "Physical", format: "pct" }, { key: "economic", label: "Economic", format: "pct", dashed: true }]} drill="/app/units?f.status=Vacant" height={200} />
          </GridItem>
          <GridItem span={6}>
            <ChartCard title="Delinquency aging" description="Open balances by days late" kind="stacked" data={aging} x="month" series={[{ key: "d0_30", label: "0–30", format: "money" }, { key: "d31_60", label: "31–60", format: "money" }, { key: "d61_90", label: "61–90", format: "money", color: "var(--chart-4)" }, { key: "d90", label: "90+", format: "money", color: "var(--chart-5)" }]} drill="/app/receivables/delinquency?month={month}" actions={explain} height={200} />
          </GridItem>
          <GridItem span={6}>
            <ChartCard title="NOI by property" description="October · top 8" kind="hbar" data={byProperty} x="property" series={[{ key: "noi", label: "NOI", format: "money" }]} drill="/app/properties/{property_id}" height={260} />
          </GridItem>
          <GridItem span={6}>
            <ChartCard title="Leasing funnel" description="Last 90 days · conversion from the previous stage" kind="funnel" data={funnel} x="stage" series={[{ key: "n", label: "Prospects" }]} drill="/app/leasing/prospects?f.stage={stage}" />
          </GridItem>
          <GridItem span={6}>
            <ChartCard title="Work orders opened" description="By day and hour · last 8 weeks" kind="heatmap" data={heat} x="day" series={[]} heatmap={{ col: "hour", value: "wos" }} drill="/app/maintenance/work-orders?day={day}&hour={hour}" />
          </GridItem>
          <GridItem span={3}>
            <ChartCard title="Vacancy loss" kind="bar" data={[]} x="month" series={[{ key: "loss", label: "Loss", format: "money" }]} empty="No vacancy loss recorded in this range." height={150} />
          </GridItem>
          <GridItem span={3}>
            <ChartCard title="Payables aging" kind="bar" data={[]} x="bucket" series={[{ key: "amt", label: "Open", format: "money" }]} loading height={150} />
          </GridItem>
        </DashboardGrid>
      </div>
    </Section>
  );
}
