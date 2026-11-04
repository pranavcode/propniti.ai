// Entity defs for the intelligence module. Call registerEntity() from "../registry" for each def.
// Owned by the intelligence module lane; see AGENTS.md "v2 lanes and ownership".
import { CheckSquare } from "lucide-react";
import { AGENT_KEYS } from "../types";
import { registerEntity } from "../registry";
import { AS_OF, STAFF } from "../common";

const OPEN = "tasks.status IN ('Open', 'In progress')";
const AGENT_LIST = AGENT_KEYS.map((k) => `'${k}'`).join(", ");
// Tasks don't store the run that created them. An agent's task comes from executing one of its
// proposals on the same record, so the latest proposal on that record at or before the task is
// the one that produced it; its agent and run are shown on the task.
const proposalOf = (col: "agent" | "run_id") =>
  `CASE WHEN tasks.source = 'Agent' THEN (SELECT p.${col} FROM {ai_proposals} p WHERE p.entity_type = tasks.entity_type AND p.entity_id = tasks.entity_id AND p.created_at <= tasks.created_at ORDER BY p.created_at DESC LIMIT 1) END`;

registerEntity({
  key: "tasks",
  table: "tasks",
  label: { one: "Task", many: "Tasks" },
  icon: CheckSquare,
  module: "intelligence",
  route: "/app/tasks",
  titleField: "title",
  subtitle: (r) => [r.property_id__label, r.detail].filter(Boolean).join(" · ").slice(0, 140),
  scopePath: "tasks.property_id",
  fields: {
    title: { type: "text", label: "Task", required: true, search: true, sortable: true, list: { default: true, width: 360 } },
    detail: { type: "text", label: "Details", search: true, list: { default: false } },
    // Where the task sits on the demo clock: the four views of My tasks, with counts.
    bucket: { type: "enum", label: "When", sortable: false, list: { default: false },
      sql: `CASE WHEN NOT ${OPEN} THEN 'done' WHEN tasks.due_on IS NULL OR tasks.due_on > ${AS_OF} THEN 'upcoming' WHEN tasks.due_on = ${AS_OF} THEN 'today' ELSE 'overdue' END`,
      enum: [{ value: "overdue", label: "Overdue", tone: "danger" }, { value: "today", label: "Today", tone: "warning" }, { value: "upcoming", label: "Upcoming", tone: "info" }, { value: "done", label: "Done", tone: "success" }] },
    status: { type: "enum", label: "Status", system: true, initial: ["Open"], sortable: true, list: { default: true },
      enum: [{ value: "Open", tone: "neutral" }, { value: "In progress", tone: "info" }, { value: "Done", tone: "success" }, { value: "Cancelled", tone: "neutral" }],
      help: { summary: "Mark a task done, or reopen it, with its actions. Each change is recorded in the audit log." } },
    due_on: { type: "date", label: "Due", sortable: true, list: { default: true } },
    priority: { type: "enum", label: "Priority", facet: true, sortable: true, list: { default: true },
      enum: [{ value: "High", tone: "danger" }, { value: "Normal", tone: "neutral" }, { value: "Low", tone: "neutral" }] },
    property_id: { type: "ref", ref: "properties", label: "Property", facet: true, sortable: true, list: { default: true }, editable: [] },
    entity_type: { type: "text", label: "Related to", system: true, facet: true, list: { default: false } },
    entity_id: { type: "text", label: "Related record", system: true, list: { default: false } },
    assignee_id: { type: "ref", ref: "staff", label: "Assigned to", sortable: true, list: { default: false } },
    assignee_role: { type: "text", label: "Assigned role", system: true, list: { default: false } },
    // The person, or the role, the task is for: My tasks filters on [persona id, "role:<role>"].
    assignee_key: { type: "text", label: "Assignee key", list: { default: false }, sql: "coalesce(tasks.assignee_id, 'role:' || tasks.assignee_role)" },
    source: { type: "enum", label: "Source", system: true, facet: true, sortable: true, list: { default: true },
      enum: [{ value: "Manual", label: "Person", tone: "neutral" }, { value: "Automation", tone: "info" }, { value: "Agent", label: "AI agent", tone: "ai" }, { value: "Preventive", tone: "info" }] },
    created_by: { type: "ref", ref: "staff", label: "Created by", system: true, list: { default: false } },
    agent: { type: "text", label: "Agent", list: { default: false }, sql: `CASE WHEN tasks.source = 'Agent' THEN coalesce(CASE WHEN tasks.created_by IN (${AGENT_LIST}) THEN tasks.created_by END, ${proposalOf("agent")}) END` },
    run_id: { type: "text", label: "Agent run", list: { default: false }, sql: proposalOf("run_id") },
    completed_at: { type: "datetime", label: "Completed", system: true, sortable: true, list: { default: false } },
    created_at: { type: "datetime", label: "Created", system: true, sortable: true, list: { default: false } },
  },
  relations: [
    { name: "property", entity: "properties", fk: "property_id", kind: "one" },
    { name: "assignee", label: "Assigned to", entity: "staff", fk: "assignee_id", kind: "one" },
  ],
  list: {
    defaultSort: ["due_on", "asc"],
    statusTabs: "bucket",
  },
  detail: {
    facts: ["status", "due_on", "priority", "property_id", "assignee_id", "source", "created_by"],
    tabs: [{ key: "overview", label: "Overview", fields: ["title", "detail", "status", "due_on", "priority", "property_id", "entity_type", "entity_id", "assignee_id", "assignee_role", "source", "created_by", "completed_at", "created_at"] }],
    related: ["property"],
  },
  capabilities: { notes: true, activity: true },
  // Anyone on staff reads tasks in their scope; leaders and the roles with write access to the
  // intelligence module edit the wording, due date and priority. Status changes only through
  // tasks.complete and tasks.reopen; tasks are created from a record or from My tasks.
  permissions: { read: [...STAFF], update: [...STAFF] },
  writes: "generic",
  actions: ["tasks.complete", "tasks.reopen"],
  help: { summary: "Follow-ups assigned to a person or a role, from people, automations and AI agents, each tied to the record it is about." },
});
