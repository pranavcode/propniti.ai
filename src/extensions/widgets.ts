import type { ReactNode } from "react";
import type { Actor, Role, WidgetKey } from "@/entities/types";

// Dashboard cards (plan §4, extension point 3). Persona home pages list widget keys; each widget
// renders itself (server component) for the acting persona's scope.

export type WidgetProps = { actor: Actor };
export type Widget = { key: WidgetKey; title: string; roles: Role[]; size: "sm" | "md" | "lg" | "full"; component: (props: WidgetProps) => ReactNode | Promise<ReactNode> };

const widgets = new Map<WidgetKey, Widget>();

export const registerWidget = (w: Widget) => (widgets.set(w.key, w), w);
export const getWidget = (key: string) => widgets.get(key as WidgetKey);
export const widgetsFor = (role: Role) => [...widgets.values()].filter((w) => w.roles.includes(role));
