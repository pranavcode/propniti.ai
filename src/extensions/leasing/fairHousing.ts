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

// Singling out people by a protected characteristic, in notices that go to every resident
// (announcement drafts) and in requests to screen or rank people (the assistant). A trait counts
// only when it describes the people addressed or screened: "residents with kids", "Jewish
// applicants", "seniors should…". A place or service named after a group ("the children's play
// area", "the ramp for wheelchair users"), language access and offers of help do not.
const PEOPLE = "(?:residents?|tenants?|applicants?|people|persons?|families|households?|neighbou?rs?|renters?|prospects?|anyone|everyone|someone|those|ones|occupants?|guests?|leads?)";
const NOT_POSSESSIVE = "(?!'|’|s'|s’)";
type Trait = { category: FairHousingCategory; with?: string; adjective?: string; noun?: string };
const TRAITS: Trait[] = [
  { category: "Familial status", with: "(?:kids|children|a child|child|babies|a baby|infants?|toddlers?|minors|teen(?:ager)?s|a family|families|a pregnancy)", adjective: "(?:pregnant|expecting|single[- ]parent)", noun: "(?:kids|children|families|parents|single (?:moms?|mothers?|dads?|fathers?|parents?)|expecting mothers?)" },
  { category: "Age", with: "(?:(?:under|over|older than|younger than|above|below|past) \\d{2}|(?:who are |that are )?(?:old|older|elderly|young|retired))", adjective: "(?:old|older|elderly|young|younger|senior|retired)", noun: "(?:seniors|elderly|retirees|old people|young people|the old|the young|old ones|young ones)" },
  { category: "Disability", with: "(?:(?:a )?disabilit(?:y|ies)|wheelchairs?|(?:a )?mental illness|walkers?)", adjective: "(?:disabled|handicapped|blind|deaf|mentally ill)", noun: "(?:the disabled|the handicapped|wheelchair users)" },
  { category: "Race or national origin", with: "(?:accents?|(?:who |that )?(?:don'?t|doesn'?t|do not|does not|can'?t|cannot) speak english|(?:who |that )?(?:aren'?t|are not|isn'?t|is not) (?:us |u\\.s\\. |american )?citizens?)", adjective: "(?:black|white|asian|hispanic|latin[oa]|latinx|mexican|african|arab|immigrant|foreign|undocumented|non-?citizen|non-?english[- ]speaking)", noun: "(?:immigrants?|foreigners?|non-?citizens?|non-?english speakers?)" },
  { category: "Religion", adjective: "(?:jewish|muslim|christian|catholic|hindu|sikh|religious)", noun: "(?:jews|muslims|christians|catholics|hindus|sikhs)" },
  { category: "Sex", adjective: "(?:female|male|women|men|gay|lesbian|transgender|lgbt\\w*)", noun: "(?:women|men|females|males|gay people)" },
  { category: "Source of income", with: "(?:(?:section 8|housing choice) vouchers?|section 8|vouchers?|housing assistance|public assistance)", adjective: "(?:section 8|voucher)", noun: "(?:voucher holders)" },
];
const DIRECTIVE = "(?:should|must|need to|needs to|have to|has to|are (?:advised|asked|required|encouraged|reminded|expected|not (?:allowed|permitted|welcome))|may not|cannot|can'?t|will (?:need|have) to|are to)";
const STANDALONE = "(?:who |that )?(?:don'?t|doesn'?t|do not|does not|can'?t|cannot) speak english|(?:who |that )?(?:aren'?t|are not) (?:us |u\\.s\\. |american )?citizens";
const re = (src: string) => new RegExp(src, "gi");
const RULES_FOR = TRAITS.map((t) => ({
  category: t.category,
  // Addressed or described people: "residents with kids", "applicants under 40", "Jewish applicants".
  people: [
    t.with && `\\b${PEOPLE} (?:with|who have|who has|having|in|on|who are|that are|that have)? ?${t.with}\\b`,
    t.adjective && `\\b${t.adjective} ${PEOPLE}\\b`,
    t.category === "Race or national origin" && `\\b(?:${STANDALONE})\\b`,
  ].filter(Boolean).map((x) => re(x as string)),
  // Told what to do: "Seniors should use the north entrance".
  directive: t.noun ? re(`\\b${t.noun}${NOT_POSSESSIVE} ${DIRECTIVE}\\b`) : null,
  // Named as the object of screening: "skip families", "don't rent to women".
  noun: t.noun ? re(`\\b${t.noun}\\b${NOT_POSSESSIVE}(?! (?:area|room|pool|playground|club|night|program|menu|event|section|zone)s?\\b)`) : null,
}));
// Offers of help or access name disability without singling anyone out.
const ACCESS_HELP = /\b(reasonable )?accommodat\w*|accessib\w*|\bADA\b|\bramps?\b|\bcall\b|\bcontact\b|\bhelp\b|\bassist\w*|\brequest\w*/i;
// Language access names a language without singling anyone out.
const LANGUAGE_ACCESS = /\bavailable in\b|\btranslat\w*|\binterpret\w*|\bin (spanish|vietnamese|chinese|korean|tagalog|arabic|french|other languages)\b/i;

function findTraits(text: string, screening: boolean): { phrase: string; category: FairHousingCategory }[] {
  const out = checkFairHousing(text).map((f) => ({ phrase: f.phrase, category: f.category }));
  const add = (phrase: string, category: FairHousingCategory) => { if (!out.some((o) => o.phrase.toLowerCase() === phrase.toLowerCase())) out.push({ phrase, category }); };
  for (const sentence of text.split(/(?<=[.!?;])\s+|\n+/)) {
    // One phrase per stretch of text: "residents with children are advised" is one finding.
    const seen: [number, number][] = [];
    for (const r of RULES_FOR) {
      if (r.category === "Disability" && ACCESS_HELP.test(sentence)) continue;
      const patterns = [...r.people, ...(r.directive ? [r.directive] : []), ...(screening && r.noun ? [r.noun] : [])];
      for (const p of patterns) {
        for (const m of sentence.matchAll(p)) {
          if (r.category === "Race or national origin" && /english/i.test(m[0]) && LANGUAGE_ACCESS.test(sentence)) continue;
          const [a, b] = [m.index!, m.index! + m[0].length];
          if (seen.some(([x, y]) => a < y && x < b)) continue;
          seen.push([a, b]);
          add(m[0], r.category);
        }
      }
    }
  }
  return out;
}

export const protectedTargeting = (text: string | null | undefined) => (text ? findTraits(text, false) : []);

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

// Requests to rank, screen or pick people by a protected characteristic are refused. Only screening
// verbs aimed at people count: "list residents with children for the lead paint disclosure" is a
// lookup, "skip anyone with kids" is screening. Saying "ignoring fair housing" changes nothing.
const SCREEN = /\b(rank\w*|skip\w*|exclud\w*|reject\w*|den(y|ies|ied)|prefer\w*|avoid\w*|drop\w*|weed\w* out|leave out|filter\w* out|screen\w* out|only (approve|accept|rent|lease|show|consider|pick|choose)\w*|(don'?t|do not|never|won'?t|stop) (rent|lease|show|approve|accept)\w*)\b/i;
export function screensByProtectedClass(q: string): { phrase: string; category: FairHousingCategory }[] {
  return SCREEN.test(q) ? findTraits(q, true) : [];
}

export function fairHousingRefusal(flags: { phrase: string; category: FairHousingCategory }[]) {
  const what = [...new Set(flags.map((f) => f.category.toLowerCase()))].join(" or ");
  const notes = [
    flags.some((f) => /citizen/i.test(f.phrase)) ? " Where a program legally requires an immigration or status check, it runs through the screening provider the same way for every applicant." : "",
    flags.some((f) => f.category === "Source of income") ? " Source of income, including vouchers, is protected in many states and cities; state the income criteria instead." : "",
  ].join("");
  return `I can't help choose or screen people by ${what}; that's a protected characteristic under fair housing law, so Propniti doesn't use it.${notes} Every applicant and resident is treated on the same terms: applications are scored only on income to rent, credit band, rental history and income verification. I can rank applications on those criteria for everyone.`;
}
