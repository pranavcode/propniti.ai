// Actions, tabs, metrics and nav for the owners module (owner statements and the four portals).
import { FileSpreadsheet } from "lucide-react";
import { registerPage } from "@/entities/registry";
import "./actions";
import "./portal-actions";
import "./metrics";
import "./tabs";

registerPage({ key: "owner-statements", label: "Owner statements", href: "/app/owner-statements", icon: FileSpreadsheet, section: "finance", group: "Owners", order: 60, roles: ["platform_admin", "principal", "regional_manager", "property_manager", "broker", "accountant", "admin"] });
