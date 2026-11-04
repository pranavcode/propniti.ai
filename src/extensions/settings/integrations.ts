// Simulated integrations shown in Settings → Integrations. Status is stored per org in
// user_preferences.data.integrations; nothing calls an outside service in the demo.

export type IntegrationDef = { key: string; name: string; category: "Banking" | "Payments" | "Leasing" | "Messaging"; description: string; default: "Connected" | "Not connected" | "Needs attention"; detail: string };

export const INTEGRATIONS: IntegrationDef[] = [
  { key: "plaid", name: "Plaid bank feeds", category: "Banking", description: "Daily transactions from the trust, deposit and operating accounts, for reconciliation and deposit matching.", default: "Connected", detail: "17 accounts at Truist, Chase and Wells Fargo" },
  { key: "bank_ach", name: "Bank ACH origination", category: "Banking", description: "Owner distributions and vendor payments leave the trust account by ACH.", default: "Connected", detail: "Same-day ACH cut-off 2:00 pm CT" },
  { key: "stripe", name: "Stripe payments", category: "Payments", description: "Residents pay rent by card or bank account in the portal; payouts land in the trust account.", default: "Connected", detail: "Card fee passed to the resident: 2.9% + 30¢" },
  { key: "syndication", name: "Listing syndication", category: "Leasing", description: "Publishes vacant units with photos and pricing to Zillow Rentals, Apartments.com and Zumper.", default: "Needs attention", detail: "Zumper feed rejected 3 listings without square footage" },
  { key: "email", name: "Email delivery", category: "Messaging", description: "Resident, owner and vendor email from templates and the AI drafts you approve.", default: "Connected", detail: "Sending domain summitresidential.example verified" },
  { key: "sms", name: "SMS", category: "Messaging", description: "Rent reminders, maintenance updates and tour confirmations by text, with opt-out handling.", default: "Not connected", detail: "Register a 10DLC campaign to send texts" },
];
