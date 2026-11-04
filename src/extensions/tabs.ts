import type { ReactNode } from "react";
import type { Actor, EntityKey, Role, Row, TabKey } from "@/entities/types";

// Custom detail tabs (plan §4, extension point 3), referenced from EntityDef.detail.tabs as
// { custom: "<module>.<name>" }. The component is a server component unless it says "use client".

export type TabProps = { entity: EntityKey; id: string; row: Row; actor: Actor };
export type CustomTab = { key: TabKey; label: string; entity: EntityKey; roles?: Role[]; component: (props: TabProps) => ReactNode | Promise<ReactNode> };

const tabs = new Map<TabKey, CustomTab>();

export const registerTab = (tab: CustomTab) => (tabs.set(tab.key, tab), tab);
export const getTab = (key: string) => tabs.get(key as TabKey);
