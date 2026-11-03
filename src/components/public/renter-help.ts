// Renter-facing help articles. The listing Q&A answers from these plus the listing's own data.
// Lane A seeds them into help_articles (ids renter-*, tag "renter"); this copy is the fallback.

export type RenterArticle = { id: string; title: string; body: string };

export const RENTER_HELP: RenterArticle[] = [
  {
    id: "renter-apply",
    title: "How to apply for a home",
    body: "Press Apply on the listing. The application has five short steps: your details, where you've lived, income, documents and consent. It takes about 10 minutes. Each adult who will live in the home fills in an application. After you submit, a status page shows where your application is and what happens next.",
  },
  {
    id: "renter-screening",
    title: "What we look at when you apply",
    body: "We review every application with the same written criteria: household income of about 3 times the monthly rent (combined for co-applicants), rental history, and a credit check. A low credit score doesn't mean an automatic denial; we may offer a conditional approval with a larger deposit. We do not ask about or use arrest records. Any other record is reviewed individually by a person. A person always makes the final decision, and you can ask for the reasons in writing.",
  },
  {
    id: "renter-fees",
    title: "Fees and deposits",
    body: "The application fee is $50 per adult and covers the screening cost. After approval, you pay a one-time administration fee and the security deposit before move-in. The listing shows the exact amounts and an estimate of your move-in total. Deposits are returned after move-out, minus any documented charges, within the time your state requires.",
  },
  {
    id: "renter-tours",
    title: "Booking a tour",
    body: "Choose In person, Self-guided or Video on the listing, then pick a day and time. The tour goes straight onto the leasing team's calendar. Self-guided tours need a photo ID at check-in. To change or cancel, ask the leasing contact named on the listing.",
  },
  {
    id: "renter-pets",
    title: "Pets and assistance animals",
    body: "Pet-friendly homes allow up to 2 cats or dogs, with a refundable pet deposit and monthly pet rent shown on the listing. Assistance animals, including service and support animals for people with disabilities, are not pets: they are allowed in every home, and pet deposits, pet rent and pet limits don't apply to them. You can ask for this or any other reasonable accommodation at any time.",
  },
  {
    id: "renter-fair-housing",
    title: "Fair housing",
    body: "We follow the federal Fair Housing Act and state and local fair housing laws. We don't discriminate based on race, color, religion, sex (including sexual orientation and gender identity), national origin, familial status or disability. We describe homes and places, not the people who live nearby, so we can't answer questions about who lives in a building or neighborhood. For school information, contact the local school district. For crime statistics, see your local police department's public data.",
  },
];
