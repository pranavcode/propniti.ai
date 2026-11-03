import type { ActionKey } from "@/entities/types";

// Action keys only agents propose (registered in ./actions.ts); approving runs the proposal's effects.
export const AI_ACTIONS: { key: ActionKey; label: string }[] = [
  { key: "leases.send_reminder", label: "Send rent reminder" },
  { key: "leases.offer_payment_plan", label: "Offer payment plan" },
  { key: "leases.refer_to_legal", label: "Refer for legal review" },
  { key: "leases.send_renewal_offer", label: "Send renewal offer" },
  { key: "households.send_reminder", label: "Send rent reminder" },
  { key: "households.offer_payment_plan", label: "Offer payment plan" },
  { key: "work_orders.triage", label: "Apply triage" },
  { key: "work_orders.assign_vendor", label: "Assign vendor" },
  { key: "bills.hold", label: "Hold for review" },
  { key: "vendors.verify_bank_change", label: "Hold payments and verify bank change" },
  { key: "vendors.stop_assigning", label: "Stop assigning work" },
  { key: "vendors.request_coi", label: "Request certificate of insurance" },
  { key: "data_issues.apply_fix", label: "Apply data fix" },
  { key: "owner_entities.send_explanation", label: "Send variance explanation" },
  { key: "compliance_items.schedule", label: "Schedule" },
  { key: "applications.approve", label: "Approve application" },
  { key: "applications.deny", label: "Deny application" },
];
export const isAiAction = (key: string) => AI_ACTIONS.some((a) => a.key === key);
