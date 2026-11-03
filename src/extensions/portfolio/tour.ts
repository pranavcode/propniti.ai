import { registerTour } from "@/components/app/tour/registry";

// Product tours for the two personas whose home is the portfolio dashboard.
registerTour({
  id: "portfolio-principal",
  title: "Your portfolio home",
  roles: ["principal"],
  steps: [
    { href: "/app", target: "briefing", title: "Start with the briefing", body: "What changed at the last month-end close, what the agents did in the last 48 hours, what needs your decision and what to watch.", placement: "bottom" },
    { target: "kpis", title: "Every number explains itself", body: "Click a KPI for the rows behind it. Select Explain for the change month over month, split by property and driver, with a link to the agent run that worked it out.", placement: "bottom" },
    { target: "ask-home", title: "Ask about the portfolio", body: "Ask in plain English. Answers come from your data, and the assistant lists every record it looked up.", placement: "left" },
    { target: "approvals", title: "Decide what agents propose", body: "Agents never move money on their own. Approve or reject here; each decision is recorded with your name.", placement: "top" },
    { href: "/app/portfolio/what-if", target: "whatif-levers", title: "Test a scenario", body: "Change rent, occupancy and operating expenses for the portfolio, a metro or one property and see NOI per property.", placement: "right" },
    { target: "whatif-explain", title: "Get the scenario in words", body: "The AI writes up the scenario from the computed figures. Every number it uses comes from the calculation.", placement: "left" },
  ],
});

registerTour({
  id: "portfolio-regional",
  title: "Your region at a glance",
  roles: ["regional_manager"],
  steps: [
    { href: "/app", target: "briefing", title: "Your region's briefing", body: "Month-end results, agent activity, decisions waiting on you and the properties that need attention.", placement: "bottom" },
    { target: "compare", title: "Compare your properties", body: "Sort by variance to budget, occupancy, collections or SLA. Select Variance on a row and the AI explains that property's NOI change from computed drivers.", placement: "top" },
    { target: "kpis", title: "Explain any number", body: "Each KPI drills to its rows; Explain shows which properties moved it.", placement: "bottom" },
    { target: "approvals", title: "Approvals in your region", body: "Concessions, work-order spend and other proposals over policy limits wait here for you.", placement: "top" },
  ],
});
