// Actions, tabs, metrics, pages and the tour for the residents module (residents, leases, messaging).
import { LayoutDashboard, Sun } from "lucide-react";
import { registerPage } from "@/entities/registry";
import "./metrics";
import "./actions";
import "./tabs";
import "./tour";

registerPage({ key: "home.today", label: "Today", href: "/app/today", icon: Sun, section: "home", order: 0, roles: ["property_manager", "regional_manager"] });
registerPage({ key: "residents.dashboard", label: "Resident dashboard", href: "/app/residents/dashboard", icon: LayoutDashboard, section: "operations", order: 19, roles: ["platform_admin", "principal", "regional_manager", "property_manager", "leasing_agent", "broker", "accountant", "admin"] });
