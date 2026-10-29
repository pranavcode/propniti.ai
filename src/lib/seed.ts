import { PM, TRUST, managementFee } from "./ledger";
import type { DemoState, PersonaId } from "./types";

// Fixed "today" so the mock data reads the same on every visit.
export const DEMO_TODAY = "2026-10-28";

export const PERSONAS: Record<PersonaId, { userId: string; label: string; blurb: string }> = {
  pm: { userId: "u-pm", label: "Property manager", blurb: "Runs the portfolio. Sees alerts, approves agent actions, validates vendor work." },
  owner: { userId: "u-owner1", label: "Owner", blurb: "Limited dashboard for their own properties: occupancy, rent, payouts." },
  tenant: { userId: "u-t1", label: "Tenant", blurb: "Tenancy details, invoices and upcoming rent, pay and report issues." },
  maintenance: { userId: "u-m1", label: "Maintenance", blurb: "In-house jobs with time estimates; update status and add photos." },
  vendor: { userId: "u-v1", label: "Vendor", blurb: "Work orders against POs, submit invoices with photos, payouts and 1099." },
  admin: { userId: "u-admin", label: "Admin", blurb: "Users, system health, AI mode and the full audit log." },
};

export function seed(): DemoState {
  return {
    properties: [
      { id: "p1", name: "Riverside Lofts", address: "1200 E Riverside Dr, Austin, TX", type: "Multifamily", units: 24, occupied: 22, ownerId: "u-owner1" },
      { id: "p2", name: "Oak Street Duplex", address: "418 Oak St, Austin, TX", type: "Duplex", units: 2, occupied: 2, ownerId: "u-owner1" },
      { id: "p3", name: "Harbor View Commercial", address: "77 Harbor Blvd, San Diego, CA", type: "Commercial", units: 6, occupied: 5, ownerId: "u-owner2" },
    ],
    users: [
      { id: "u-pm", name: "Maya Patel", role: "Property manager", email: "maya@summitres.example", phone: "(512) 555-0101", channel: "Email", idVerified: true },
      { id: "u-owner1", name: "Robert Chen", role: "Owner", email: "robert.chen@example.com", phone: "(512) 555-0142", channel: "Email", idVerified: true },
      { id: "u-owner2", name: "Linda Alvarez", role: "Owner", email: "linda@alvarezholdings.example", phone: "(619) 555-0177", channel: "Email", idVerified: true },
      { id: "u-t1", name: "Jasmine Brooks", role: "Tenant", email: "jasmine.b@example.com", phone: "(512) 555-0204", channel: "SMS", idVerified: true },
      { id: "u-t2", name: "Marcus Lee", role: "Tenant", email: "marcus.lee@example.com", phone: "(512) 555-0110", channel: "SMS", idVerified: true },
      { id: "u-t3", name: "Priya Nair", role: "Tenant", email: "priya.n@example.com", phone: "(512) 555-0305", channel: "WhatsApp", idVerified: true },
      { id: "u-t4", name: "Tom Becker", role: "Tenant", email: "tbecker@example.com", phone: "(512) 555-0418", channel: "Email", idVerified: false },
      { id: "u-t5", name: "Aisha Khan", role: "Tenant", email: "aisha.k@example.com", phone: "(512) 555-0419", channel: "Voice", idVerified: true },
      { id: "u-t6", name: "Northwind Dental (Dr. Kim)", role: "Tenant", email: "office@northwinddental.example", phone: "(619) 555-0303", channel: "Email", idVerified: true },
      { id: "u-m1", name: "Luis Romero", role: "Maintenance", email: "luis@summitres.example", phone: "(512) 555-0160", channel: "SMS", idVerified: true },
      { id: "u-v1", name: "Derek Simmons", role: "Vendor", email: "derek@coolairhvac.example", phone: "(512) 555-0190", channel: "Email", idVerified: true },
      { id: "u-v2", name: "Rosa Diaz", role: "Vendor", email: "rosa@quickfixplumbing.example", phone: "(619) 555-0122", channel: "SMS", idVerified: true },
      { id: "u-v3", name: "Ken Watts", role: "Vendor", email: "ken@brightspark.example", phone: "(512) 555-0133", channel: "Email", idVerified: false },
      { id: "u-admin", name: "Sam Okafor", role: "Admin", email: "sam@summitres.example", phone: "(512) 555-0100", channel: "Email", idVerified: true },
    ],
    vendors: [
      { id: "v1", userId: "u-v1", company: "CoolAir HVAC", trade: "HVAC", ytdPaid: 3620 },
      { id: "v2", userId: "u-v2", company: "QuickFix Plumbing", trade: "Plumbing", ytdPaid: 2150 },
      { id: "v3", userId: "u-v3", company: "BrightSpark Electric", trade: "Electrical", ytdPaid: 480 },
    ],
    tenancies: [
      { id: "t1", propertyId: "p1", unit: "#204", tenantId: "u-t1", rent: 1850, cadence: "Monthly", leaseStart: "2025-12-13", leaseEnd: "2026-12-12", status: "Renewal due" },
      { id: "t2", propertyId: "p1", unit: "#110", tenantId: "u-t2", rent: 1725, cadence: "Monthly", leaseStart: "2026-06-01", leaseEnd: "2027-05-31", status: "Active" },
      { id: "t3", propertyId: "p1", unit: "#305", tenantId: "u-t3", rent: 1950, cadence: "Monthly", leaseStart: "2026-03-01", leaseEnd: "2027-02-28", status: "Active" },
      { id: "t4", propertyId: "p2", unit: "Unit A", tenantId: "u-t4", rent: 1400, cadence: "Monthly", leaseStart: "2026-09-01", leaseEnd: "2027-08-31", status: "Active" },
      { id: "t5", propertyId: "p2", unit: "Unit B", tenantId: "u-t5", rent: 1350, cadence: "Monthly", leaseStart: "2025-12-01", leaseEnd: "2026-11-30", status: "Renewal due" },
      { id: "t6", propertyId: "p3", unit: "Suite 3", tenantId: "u-t6", rent: 4200, cadence: "Monthly", leaseStart: "2025-02-01", leaseEnd: "2028-01-31", status: "Active" },
    ],
    invoices: [
      { id: "INV-2610-01", tenancyId: "t1", amount: 1850, generated: "2026-09-25", due: "2026-10-01", status: "Paid" },
      { id: "INV-2610-02", tenancyId: "t2", amount: 1725, generated: "2026-09-25", due: "2026-10-01", status: "Overdue" },
      { id: "INV-2610-03", tenancyId: "t3", amount: 1950, generated: "2026-09-25", due: "2026-10-01", status: "Paid" },
      { id: "INV-2610-04", tenancyId: "t4", amount: 1400, generated: "2026-09-25", due: "2026-10-01", status: "Paid" },
      { id: "INV-2610-05", tenancyId: "t5", amount: 1350, generated: "2026-09-25", due: "2026-10-01", status: "Overdue" },
      { id: "INV-2610-06", tenancyId: "t6", amount: 4200, generated: "2026-09-25", due: "2026-10-01", status: "Paid" },
      { id: "INV-2611-01", tenancyId: "t1", amount: 1850, generated: "2026-10-25", due: "2026-11-01", status: "Due" },
      { id: "INV-2611-02", tenancyId: "t2", amount: 1725, generated: "2026-10-25", due: "2026-11-01", status: "Due" },
      { id: "INV-2611-03", tenancyId: "t3", amount: 1950, generated: "2026-10-25", due: "2026-11-01", status: "Due" },
      { id: "INV-2611-04", tenancyId: "t4", amount: 1400, generated: "2026-10-25", due: "2026-11-01", status: "Due" },
      { id: "INV-2611-05", tenancyId: "t5", amount: 1350, generated: "2026-10-25", due: "2026-11-01", status: "Due" },
      { id: "INV-2611-06", tenancyId: "t6", amount: 4200, generated: "2026-10-25", due: "2026-11-01", status: "Due" },
    ],
    workOrders: [
      {
        id: "WO-1041", propertyId: "p1", unit: "#204", title: "Replace AC condenser fan motor", vendorId: "v1", estimatedHours: 3, status: "Submitted",
        po: { number: "PO-5521", items: [{ description: "Condenser fan motor (1/4 HP)", amount: 380 }, { description: "Labor, 3 h @ $85", amount: 255 }], total: 635, photosRequired: 2 },
        submission: {
          invoiceNumber: "CA-88213",
          items: [{ description: "Condenser fan motor (1/4 HP)", amount: 380 }, { description: "Labor, 3 h @ $85", amount: 255 }],
          total: 635,
          photos: ["Old motor removed, burnt windings visible", "New motor installed, condenser running, serial plate visible"],
        },
      },
      {
        id: "WO-1042", propertyId: "p3", unit: "Suite 3", title: "Fix leaking water heater", vendorId: "v2", estimatedHours: 2, status: "Submitted",
        po: { number: "PO-5524", items: [{ description: "Pressure relief valve", amount: 120 }, { description: "Labor, 2 h @ $90", amount: 180 }], total: 300, photosRequired: 2 },
        submission: {
          invoiceNumber: "QF-4410",
          items: [{ description: "Pressure relief valve", amount: 120 }, { description: "Labor, 4 h @ $90", amount: 360 }, { description: "After-hours call-out fee", amount: 95 }],
          total: 575,
          photos: ["Water heater with new valve fitted"],
        },
      },
      {
        id: "WO-1043", propertyId: "p2", unit: "Unit B", title: "Repair kitchen outlet (no power)", vendorId: "v3", estimatedHours: 1.5, status: "In progress",
        po: { number: "PO-5527", items: [{ description: "GFCI outlet", amount: 35 }, { description: "Labor, 1.5 h @ $95", amount: 142.5 }], total: 177.5, photosRequired: 1 },
      },
      {
        id: "WO-1046", propertyId: "p3", unit: "All suites", title: "Quarterly HVAC service, 4 rooftop units", vendorId: "v1", estimatedHours: 6, status: "In progress",
        po: { number: "PO-5530", items: [{ description: "Quarterly rooftop unit service, 4 units @ $150", amount: 600 }], total: 600, photosRequired: 2 },
      },
      {
        id: "WO-1044", propertyId: "p1", unit: "Hallway, floor 2", title: "Replace two hallway light fixtures", vendorId: "in-house", assigneeId: "u-m1", estimatedHours: 2, status: "Assigned",
        po: { number: "PO-5528", items: [{ description: "LED fixtures x2", amount: 240 }], total: 240, photosRequired: 1 },
      },
      {
        id: "WO-1045", propertyId: "p1", unit: "#110", title: "Unclog bathroom drain", vendorId: "in-house", assigneeId: "u-m1", estimatedHours: 1, status: "In progress",
        po: { number: "PO-5529", items: [{ description: "Labor only", amount: 0 }], total: 0, photosRequired: 1 },
      },
    ],
    transfers: [
      // October rent that cleared, with the 8% fee taken from trust.
      ...([
        ["INV-2610-01", "u-t1", "Jasmine Brooks", "p1", 1850, "2026-09-30"],
        ["INV-2610-03", "u-t3", "Priya Nair", "p1", 1950, "2026-10-01"],
        ["INV-2610-04", "u-t4", "Tom Becker", "p2", 1400, "2026-10-01"],
        ["INV-2610-06", "u-t6", "Northwind Dental (Dr. Kim)", "p3", 4200, "2026-10-02"],
      ] as const).flatMap(([inv, tid, tname, pid, amt, date]) => [
        { id: `tr-${inv}`, key: `rent:${inv}`, kind: "Rent" as const, from: { kind: "tenant" as const, id: tid, name: tname }, to: TRUST, amount: amt, propertyId: pid, ref: inv, status: "Cleared" as const, created: date, cleared: date },
        { id: `fee-${inv}`, key: `fee:${inv}`, kind: "Management fee" as const, from: TRUST, to: PM, amount: managementFee(amt), propertyId: pid, ref: inv, status: "Cleared" as const, created: date, cleared: date },
      ]),
      { id: "tr-sep-v1", key: "vendor:WO-1019", kind: "Vendor payout", from: TRUST, to: { kind: "vendor", id: "v1", name: "CoolAir HVAC" }, amount: 1240, propertyId: "p1", ref: "WO-1019", status: "Cleared", created: "2026-09-18", cleared: "2026-09-19", statement: "sep" },
      { id: "tr-sep-o1", key: "owner:sep-o1", kind: "Owner payout", from: TRUST, to: { kind: "owner", id: "u-owner1", name: "Robert Chen" }, amount: 35200, propertyId: "p1", ref: "Statement 2026-10-06", status: "Cleared", created: "2026-10-06", cleared: "2026-10-07", statement: "sep" },
      { id: "tr-sep-o2", key: "owner:sep-o2", kind: "Owner payout", from: TRUST, to: { kind: "owner", id: "u-owner2", name: "Linda Alvarez" }, amount: 21400, propertyId: "p3", ref: "Statement 2026-10-06", status: "Cleared", created: "2026-10-06", cleared: "2026-10-07", statement: "sep" },
      // Opening balance carried into trust before the demo period.
      { id: "tr-open", key: "opening", kind: "Rent", from: { kind: "tenant", id: "various", name: "Opening balance (September rent)" }, to: TRUST, amount: 58000, propertyId: "p1", ref: "Opening balance", status: "Cleared", created: "2026-09-30", cleared: "2026-09-30", statement: "sep" },
    ],
    ratings: [
      { id: "r1", by: "u-t1", subject: { kind: "pm", id: "u-pm" }, stars: 5, comment: "Replies the same day, every time.", ts: "2026-10-20 18:02" },
      { id: "r2", by: "u-t2", subject: { kind: "pm", id: "u-pm" }, stars: 3, comment: "Good, but the parking gate took weeks to fix.", ts: "2026-10-11 09:40" },
      { id: "r3", by: "u-t1", subject: { kind: "property", id: "p1" }, stars: 5, comment: "Quiet, clean and well kept.", ts: "2026-10-20 18:03" },
      { id: "r4", by: "u-t3", subject: { kind: "property", id: "p1" }, stars: 4, comment: "Lovely unit; the gym is often closed.", ts: "2026-10-15 12:10" },
      { id: "r5", by: "u-t6", subject: { kind: "property", id: "p3" }, stars: 4, comment: "Great location for our patients.", ts: "2026-10-03 08:30" },
      { id: "r6", by: "u-t2", subject: { kind: "maintenance", id: "u-m1" }, stars: 5, comment: "Fixed the leak the same afternoon.", ref: "WO-1033", ts: "2026-10-09 17:45" },
      { id: "r7", by: "u-t4", subject: { kind: "maintenance", id: "u-m1" }, stars: 4, comment: "Friendly and tidy.", ref: "WO-1036", ts: "2026-09-29 14:20" },
      { id: "r8", by: "u-pm", subject: { kind: "vendor", id: "v1" }, stars: 5, comment: "On time, invoice matched the PO.", ref: "WO-1019", ts: "2026-09-19 10:00" },
      { id: "r9", by: "u-pm", subject: { kind: "vendor", id: "v2" }, stars: 2, comment: "Arrived three hours late; added charges not on the PO.", ref: "WO-1031", ts: "2026-10-05 16:15" },
    ],
    notifications: [
      { id: "n1", userId: "u-t2", channel: "SMS", message: "Hi Marcus, your October rent of $1,725 is overdue. Pay in the app or reply HELP.", ts: "2026-10-27 09:00" },
      { id: "n2", userId: "u-t1", channel: "SMS", message: "Hi Jasmine, your lease at Riverside Lofts #204 ends Dec 12. Want to renew? Reply YES and we'll send the renewal.", ts: "2026-10-26 10:15" },
      { id: "n3", userId: "u-t1", channel: "SMS", message: "Your November rent of $1,850 is due Nov 1.", ts: "2026-10-25 08:00" },
    ],
    audit: [
      { id: "a1", ts: "2026-10-28 08:45", actor: "Agent", action: "Scheduled sweep", detail: "2 overdue invoices, 2 leases ending within 45 days, 2 vendor submissions waiting" },
      { id: "a2", ts: "2026-10-27 09:00", actor: "Agent", action: "Nudge sent", detail: "Overdue rent reminder to Marcus Lee by SMS" },
      { id: "a3", ts: "2026-10-26 10:15", actor: "Agent", action: "Nudge sent", detail: "Lease renewal offer to Jasmine Brooks by SMS" },
      { id: "a4", ts: "2026-10-25 08:00", actor: "Agent", action: "Invoices generated", detail: "6 November rent invoices" },
    ],
  };
}
