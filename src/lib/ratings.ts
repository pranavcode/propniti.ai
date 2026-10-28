import type { Rating, RatingSubject } from "./types";

export const sameSubject = (a: RatingSubject, b: RatingSubject) => a.kind === b.kind && a.id === b.id;

export function ratingSummary(ratings: Rating[], subject: RatingSubject) {
  const mine = ratings.filter((r) => sameSubject(r.subject, subject));
  const avg = mine.length ? Math.round((mine.reduce((a, r) => a + r.stars, 0) / mine.length) * 10) / 10 : null;
  return { avg, count: mine.length, latest: mine[0] };
}

// One rating per person, subject and job: rating again replaces the earlier one.
export function upsertRating(ratings: Rating[], r: Rating): Rating[] {
  const rest = ratings.filter((x) => !(x.by === r.by && sameSubject(x.subject, r.subject) && x.ref === r.ref));
  return [r, ...rest];
}

// A 1-2 star rating is worth a manager's attention.
export const LOW_RATING = 2;
export const lowRatings = (ratings: Rating[]) => ratings.filter((r) => r.stars <= LOW_RATING);
