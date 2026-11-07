-- Portal journeys: the steps after an application decision and the resident's own answers.
-- applications: the reason shown to the applicant for a conditional approval or a denial, when the
-- lease was sent and e-signed, and the confirmed move-in date (desired_move_in is the applicant's ask).
ALTER TABLE applications ADD COLUMN decision_reason TEXT;
ALTER TABLE applications ADD COLUMN lease_sent_at TEXT;
ALTER TABLE applications ADD COLUMN lease_signed_at TEXT;
ALTER TABLE applications ADD COLUMN move_in_on TEXT;
-- renters_insurance: why staff rejected a resident's policy (status 'Rejected').
ALTER TABLE renters_insurance ADD COLUMN review_note TEXT;
-- renewal_offers: the resident's counter-offer note (status 'Countered') and the renewal e-signature.
ALTER TABLE renewal_offers ADD COLUMN resident_note TEXT;
ALTER TABLE renewal_offers ADD COLUMN signed_at TEXT;
-- photos: a resident's phone photo, as a data:image URL. Its url is then /api/photos/<id>, a
-- same-site link that checks the reader can see the work order, so no page links to data: URLs.
ALTER TABLE photos ADD COLUMN data TEXT;
