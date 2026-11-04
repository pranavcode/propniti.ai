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

// Words that single out people by a protected characteristic. Used on notices that go to every
// resident (announcement drafts) and on requests to screen or rank people (the assistant). An
// offer of a reasonable accommodation names disability without singling anyone out, so it passes.
const PEOPLE = "(residents?|tenants?|applicants?|people|persons?|families|households?|neighbou?rs?|renters?|prospects?|anyone|everyone|those|ones?)";
const TARGETS = ([
  { re: /\b(kids|children|child|babies|infants?|toddlers?|minors|teen(ager)?s|pregnan\w*|expecting mothers?|single (moms?|mothers?|dads?|fathers?|parents?)|famil(y|ies) with (kids|children|babies)|parents)\b/i, category: "Familial status" },
  { re: /\b(seniors|elderly|retirees|old people|young people|older (residents?|tenants?|applicants?|people|adults))\b/i, category: "Age" },
  { re: /\b((disabled|handicapped) PEOPLE|the (disabled|handicapped)|PEOPLE with (a )?disabilit(y|ies)|disabilit(y|ies)|wheelchair users?|mentally ill|in wheelchairs?)\b/i, category: "Disability" },
  { re: /\b(immigrants?|foreigners?|non-?english|(don'?t|doesn'?t|do not|does not|can'?t|cannot) speak english|(english|non-?native) speakers?|hispanics?|latin[oa]s?|latinx|mexicans?|asians?|africans?|arabs?|(black|white|asian|hispanic) \w*\s?PEOPLE|(by|of|their) race|racial|ethnic\w*|national origin|nationalit\w*)\b/i, category: "Race or national origin" },
  { re: /\b(christians?|muslims?|jews|hindus?|sikhs?|catholics?|religion|religious PEOPLE)\b/i, category: "Religion" },
  { re: /\b((wo)?men only|(fe)?male (only|PEOPLE)|(wo)?men PEOPLE|gay|lesbian|lgbt\w*|transgender)\b/i, category: "Sex" },
] as { re: RegExp; category: FairHousingCategory }[]).map((t) => ({ ...t, re: new RegExp(t.re.source.replace(/PEOPLE/g, PEOPLE), "gi") }));
const ACCOMMODATION = /\b(reasonable )?accommodat\w*|accessib\w*|\bADA\b/i;

export function protectedTargeting(text: string | null | undefined): { phrase: string; category: FairHousingCategory }[] {
  if (!text) return [];
  const out = checkFairHousing(text).map((f) => ({ phrase: f.phrase, category: f.category }));
  for (const sentence of text.split(/(?<=[.!?;])\s+|\n+/)) {
    for (const t of TARGETS) {
      if (t.category === "Disability" && ACCOMMODATION.test(sentence)) continue;
      for (const m of sentence.matchAll(t.re)) if (!out.some((o) => o.phrase.toLowerCase() === m[0].toLowerCase())) out.push({ phrase: m[0], category: t.category });
    }
  }
  return out;
}

// The text with every clause that singles out a protected group left out, so a notice applies to
// everyone. `removed` lists what was dropped, for the person to see.
export function withoutTargeting(text: string): { text: string; removed: string[] } {
  if (!protectedTargeting(text).length) return { text, removed: [] };
  const removed: string[] = [];
  const keep: string[] = [];
  for (const clause of text.split(/[.;!?\n]+|,\s*|\s+[-–—]\s+|\s+(?:and|but|so|while)\s+(?=\w+\s+(?:with|who|should|must|need|are|have)\b)/i)) {
    const c = clause.trim();
    if (!c) continue;
    if (protectedTargeting(c).length) removed.push(c);
    else keep.push(c);
  }
  return { text: keep.join(", "), removed };
}

// Requests to rank, screen or pick people by a protected characteristic are refused outright.
const SCREEN = /\b(rank\w*|scor\w*|screen\w*|skip\w*|exclud\w*|filter\w*|reject\w*|den(y|ied)|declin\w*|prefer\w*|avoid\w*|only|remov\w*|sort\w*|pick\w*|choos\w*|approv\w*|leave out|weed out|without|no|not? (rent|lease|show)|find|show|list)\b/i;
export function screensByProtectedClass(q: string): { phrase: string; category: FairHousingCategory }[] {
  if (ACCOMMODATION.test(q) || /\bfair[- ]housing\b/i.test(q) || !SCREEN.test(q)) return [];
  return protectedTargeting(q);
}

export function fairHousingRefusal(flags: { category: FairHousingCategory }[]) {
  const what = [...new Set(flags.map((f) => f.category.toLowerCase()))].join(" or ");
  return `I can't do that. Ranking, screening or choosing people by ${what} is illegal under the Fair Housing Act, so Propniti never uses it. Every applicant and resident is treated on the same terms: applications are scored only on income to rent, credit band, rental history and income verification. I can rank this week's applications on those criteria for everyone.`;
}
