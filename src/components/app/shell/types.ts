import type { ReactNode } from "react";
import type { NavSection, Role } from "@/entities/types";
import type { TourDef } from "../tour/types";

// Plain data the server layout hands the client shell. Icons are pre-rendered elements, because
// component functions can't cross the server/client boundary.

export type ShellNavItem = { key: string; label: string; href: string; icon: ReactNode; group?: string; count?: number; countTone?: "default" | "attention" };
export type ShellNavSection = { section: NavSection; label: string; items: ShellNavItem[] };

export type ShellPersona = { id: string; name: string; title: string; role: Role; scopeLabel: string; home: string; portal?: boolean };

export type ShellSearchEntity = { key: string; label: string; one: string; route: string; titleField: string; icon: ReactNode };
export type ShellAction = { key: string; label: string; href: string; icon?: ReactNode; hint?: string };

export type ShellData = {
  persona: ShellPersona;
  personas: ShellPersona[];
  viewingAs: boolean;                 // the visitor picked a persona (pn_as is set): show the banner
  nav: ShellNavSection[];
  searchEntities: ShellSearchEntity[];
  createActions: ShellAction[];
  quickActions: ShellAction[];
  assistantPrompts: string[];
  tours: TourDef[];
  theme: Theme;
  density: Density;
  sidebarOpen: boolean;
};

export type Theme = "light" | "dark" | "system";
export type Density = "comfortable" | "compact";

export const SECTION_LABEL: Record<NavSection, string> = {
  home: "Home", portfolio: "Portfolio", operations: "Operations", finance: "Finance", intelligence: "Intelligence", settings: "Settings",
};
