// Sample vendor invoices for the AP inbox (public/samples/invoices). Their fields were read once
// by the invoice reader and stored here, so the demo works without a vision model; the inbox labels
// them "AI · saved". Each one shows a different check: clean, unusual amount, duplicate, bank change. The duplicate
// repeats the invoice number of a paid base bill (BILL-28390, base 2026-11-04.4); keep them in step.

export type ExtractedInvoice = {
  vendor: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  total: number;
  lines: { description: string; amount: number }[];
  remit_last4?: string;
  confidence: number;
};

export type SampleInvoice = { key: string; file: string; title: string; vendor_id: string; property_id: string; received: string; extracted: ExtractedInvoice };

export const SAMPLE_INVOICES: SampleInvoice[] = [
  {
    key: "lsp-31208", file: "/samples/invoices/lone-star-plumbing-31208.png", title: "Faucet replacement, unit 412", vendor_id: "v01", property_id: "p01", received: "2026-11-03T14:12:00Z",
    extracted: {
      vendor: "Lone Star Plumbing", invoice_number: "LSP-31208", invoice_date: "2026-11-02", due_date: "2026-12-02", total: 412.5, confidence: 0.97,
      lines: [{ description: "Replace kitchen faucet and supply lines, unit 412", amount: 285 }, { description: "Parts: single-handle faucet, braided supply lines", amount: 127.5 }],
    },
  },
  {
    key: "dca-51190", file: "/samples/invoices/desert-cool-air-51190.png", title: "Emergency AC repair, unit 2108", vendor_id: "v16", property_id: "p22", received: "2026-11-03T09:40:00Z",
    extracted: {
      vendor: "Desert Cool Air", invoice_number: "DCA-51190", invoice_date: "2026-10-31", due_date: "2026-11-30", total: 1840, confidence: 0.94,
      lines: [{ description: "Condenser fan motor and run capacitor, unit 2108", amount: 640 }, { description: "After-hours emergency labor, 6.5 hours", amount: 1200 }],
    },
  },
  {
    key: "ppd-18272", file: "/samples/invoices/peachtree-plumbing-18272.png", title: "Main line hydro-jet", vendor_id: "v10", property_id: "p21", received: "2026-11-02T16:05:00Z",
    extracted: {
      vendor: "Peachtree Plumbing & Drain", invoice_number: "PPD-18272", invoice_date: "2026-11-01", due_date: "2026-12-01", total: 347, confidence: 0.96,
      lines: [{ description: "Hydro-jet main sewer line, building C", amount: 347 }],
    },
  },
  {
    key: "hch-70214", file: "/samples/invoices/hill-country-hvac-70214.png", title: "Thermostat and condensate pump", vendor_id: "v02", property_id: "p02", received: "2026-11-04T08:21:00Z",
    extracted: {
      vendor: "Hill Country HVAC", invoice_number: "HCH-70214", invoice_date: "2026-11-03", due_date: "2026-11-18", total: 386, remit_last4: "0442", confidence: 0.92,
      lines: [{ description: "Replace thermostat and condensate pump, unit 1203", amount: 386 }],
    },
  },
];
