// Actions, tabs, metrics, pages and the tour for the residents module (residents, leases, messaging).
import { Sun } from "lucide-react";
import { registerPage } from "@/entities/registry";
import "./metrics";
import "./actions";
import "./tabs";
import "./tour";

registerPage({ key: "home.today", label: "Today", href: "/app/today", icon: Sun, section: "home", order: 0, roles: ["property_manager", "regional_manager"] });
