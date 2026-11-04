// Notification types and channels for personal preferences (Settings → Notifications).

export const CHANNELS = [
  { key: "in_app", label: "In-app" },
  { key: "email", label: "Email" },
  { key: "sms", label: "SMS" },
] as const;
export type ChannelKey = (typeof CHANNELS)[number]["key"];

export const NOTIFICATION_TYPES = [
  { key: "approvals", label: "Approvals waiting on you", description: "Bills, concessions, write-offs and agent proposals over a policy limit.", default: { in_app: true, email: true, sms: false } },
  { key: "mentions", label: "@mentions and replies", description: "Someone mentions you in a note on any record.", default: { in_app: true, email: true, sms: false } },
  { key: "sla", label: "Maintenance SLA breaches", description: "Work orders past their SLA due time in your scope.", default: { in_app: true, email: false, sms: true } },
  { key: "expiries", label: "Expiring insurance and compliance", description: "Vendor COIs, property policies and compliance items due in 30 days or overdue.", default: { in_app: true, email: true, sms: false } },
  { key: "agents", label: "Agent run results", description: "What an agent did or proposed after a run you started or own.", default: { in_app: true, email: false, sms: false } },
  { key: "money", label: "Payments and deposits", description: "Large payments, NSF returns and unmatched bank deposits.", default: { in_app: true, email: false, sms: false } },
  { key: "data", label: "Critical data issues", description: "Data Health finds a critical problem, such as an unverified vendor bank change.", default: { in_app: true, email: true, sms: false } },
] as const;
export type NotificationTypeKey = (typeof NOTIFICATION_TYPES)[number]["key"];
