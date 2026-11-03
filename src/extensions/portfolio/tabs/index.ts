import { registerTab } from "@/extensions/tabs";
import { PropertyCompliance, PropertyFinancials, PropertyFloorplans, PropertyOverview, PropertyStack } from "./property";
import { UnitLeaseHistory, UnitOverview, UnitTurnovers } from "./unit";

// Custom detail tabs for properties and units (wired into the defs in src/entities/defs/portfolio.ts).

registerTab({ key: "portfolio.overview", label: "Overview", entity: "properties", component: PropertyOverview });
registerTab({ key: "portfolio.stack", label: "Unit stack", entity: "properties", component: PropertyStack });
registerTab({ key: "portfolio.floorplans", label: "Floor plans", entity: "properties", component: PropertyFloorplans });
registerTab({ key: "portfolio.financials", label: "Financials", entity: "properties", roles: ["principal", "regional_manager", "property_manager", "accountant", "owner"], component: PropertyFinancials });
registerTab({ key: "portfolio.compliance", label: "Compliance", entity: "properties", component: PropertyCompliance });

registerTab({ key: "portfolio.unit", label: "Overview", entity: "units", component: UnitOverview });
registerTab({ key: "portfolio.lease_history", label: "Lease history", entity: "units", component: UnitLeaseHistory });
registerTab({ key: "portfolio.turnover", label: "Turnovers", entity: "units", component: UnitTurnovers });
