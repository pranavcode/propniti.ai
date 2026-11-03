import { BarChart3, FileStack, Inbox, LayoutDashboard, Users } from "lucide-react";
import { registerPage } from "@/entities/registry";
import type { Role } from "@/entities/types";

// Finance custom pages live under /app/finance so they never shadow an entity route.
const FIN: Role[] = ["principal", "regional_manager", "accountant"];

registerPage({ key: "finance.home", label: "Finance overview", href: "/app/finance", icon: LayoutDashboard, section: "finance", order: 5, roles: FIN });
registerPage({ key: "finance.ap_inbox", label: "AP inbox", href: "/app/finance/ap-inbox", icon: Inbox, section: "finance", group: "Payables", order: 29, roles: FIN });
registerPage({ key: "finance.vendors", label: "Vendor payments", href: "/app/finance/vendors", icon: Users, section: "finance", group: "Payables", order: 34, roles: FIN });
registerPage({ key: "finance.1099", label: "1099 preparation", href: "/app/finance/1099", icon: FileStack, section: "finance", group: "Payables", order: 35, roles: ["accountant", "principal"] });
registerPage({ key: "finance.bva", label: "Budget vs actual", href: "/app/finance/budget-vs-actual", icon: BarChart3, section: "finance", group: "Planning", order: 69, roles: [...FIN, "property_manager"] });
