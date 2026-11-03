import { FlaskConical, LayoutDashboard } from "lucide-react";
import { registerPage } from "@/entities/registry";

// Portfolio pages that aren't entity lists: the module dashboard and the what-if simulator.
registerPage({ key: "portfolio.dashboard", label: "Overview", href: "/app/portfolio", icon: LayoutDashboard, section: "portfolio", order: 5, roles: ["principal", "regional_manager", "property_manager", "accountant", "broker", "platform_admin", "admin"] });
registerPage({ key: "portfolio.what_if", label: "What-if", href: "/app/portfolio/what-if", icon: FlaskConical, section: "portfolio", order: 45, roles: ["principal", "regional_manager", "property_manager", "accountant"] });
