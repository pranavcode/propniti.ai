// Fair-housing language check for listings and outgoing leasing messages. Phrases that state or
// imply a preference about who may live somewhere (HUD advertising guidance under the Fair Housing
// Act) are flagged with a safer wording that describes the home instead of the person.

export type FairHousingCategory = "Familial status" | "Religion" | "Race or national origin" | "Disability" | "Sex" | "Age" | "Source of income";
export type FairHousingFlag = { phrase: string; category: FairHousingCategory; suggestion: string; index: number };

const RULES: { re: RegExp; category: FairHousingCategory; suggestion: string }[] = [
  { re: /\b(no (children|kids)|adults[- ]only|adult (building|community)|child[- ]free)\b/i, category: "Familial status", suggestion: "Describe the home (\"quiet top-floor unit\") and leave out who may live there" },
  { re: /\b(perfect|ideal|great) for (singles?|a single (person|professional)|couples?|young professionals?|empty[- ]nesters?|newlyweds?|a bachelor)\b/i, category: "Familial status", suggestion: "Describe features instead, e.g. \"efficient one-bedroom layout\"" },
  { re: /\b(young professionals?|bachelor pad|mature (adults?|tenants?|residents?))\b/i, category: "Age", suggestion: "Describe the space or amenities, not the kind of resident" },
  { re: /\b(students only|seniors only|no students|no retirees)\b/i, category: "Age", suggestion: "Remove the restriction; housing for older persons needs a HOPA exemption" },
  { re: /\b(christian|jewish|muslim|catholic)\s+(home|building|community|family|tenants?|residents?)\b/i, category: "Religion", suggestion: "Remove references to religion" },
  { re: /\b(english[- ]speak(ing|ers?) only|english only|no foreigners|exclusive neighborhood|ethnic)\b/i, category: "Race or national origin", suggestion: "Remove language about origin or language spoken" },
  { re: /\b(no wheelchairs?|able[- ]bodied|must be able to (climb|walk)|no (mental|disabled)|physically fit)\b/i, category: "Disability", suggestion: "State the access facts instead, e.g. \"third floor, no elevator\"" },
  { re: /\b((fe)?male (tenants? |roommates? |residents? )?only|ideal for a (man|woman))\b/i, category: "Sex", suggestion: "Remove the preference for a sex" },
  { re: /\b(no section 8|no (housing )?vouchers?|no hud)\b/i, category: "Source of income", suggestion: "Several cities and states protect source of income; state the income criteria instead" },
];

export function checkFairHousing(text: string | null | undefined): FairHousingFlag[] {
  if (!text) return [];
  const out: FairHousingFlag[] = [];
  for (const r of RULES) {
    const re = new RegExp(r.re.source, "gi");
    for (const m of text.matchAll(re)) out.push({ phrase: m[0], category: r.category, suggestion: r.suggestion, index: m.index ?? 0 });
  }
  return out.sort((a, b) => a.index - b.index);
}

// Protected classes the applicant score never uses. Federal list plus additions common in state
// and local law; shown on the scoring panel and in the help article.
export const NEVER_SCORED = [
  "Race", "Color", "Religion", "Sex, sexual orientation or gender identity", "National origin", "Familial status (children, pregnancy)", "Disability",
  "Age", "Marital status", "Source of income (vouchers)", "Military status",
];
