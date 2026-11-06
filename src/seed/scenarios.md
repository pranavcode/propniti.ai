# Seed scenarios

The data lane implements this in `src/seed/generate.ts`. Every record falls into one of four case families. About 3–8% of records carry a **corrupted** case. Spread them so every module and persona sees some.

Each corrupted case has a `data_rules` row (`id` = `RuleKey`, e.g. `leases.end_before_start`) that detects it. It also has a precomputed `data_issues` row, with `evidence` and a `suggested_fix` (field changes or an action, a why, a confidence and a source). Rules must catch every corrupted case the generator plants; a test asserts this.

## Happy

Clean, reconciled records. These are most of the data and must tie out: rent roll, AR, trust, owner statements and trial balance (plan §3).

## Sad (real-world bad news, valid data)

| Entity | Cases |
|---|---|
| leases / charges | Delinquent (aged 0–30/31–60/61–90/90+), payment plans, one eviction in `legal_cases` |
| payments | NSF returns (`nsf = 1`) with the reversing charge and NSF fee |
| inspections | Failed items that raised work orders |
| vendor_cois | Expired and expiring within 30 days |
| units | Vacant over 90 days; down units |
| capex_projects | Over budget and behind milestones |
| work_orders | Past SLA; reopened; vendor no-show |
| renters_insurance | Lapsed |
| compliance_items | Overdue permit or certificate |

## Edge (valid but awkward)

- Month-to-month leases. Mid-month move-in/out with prorated charges. A lease starting Feb 29.
- Zero-rent employee units. Several residents on one lease. A household paying by split payments.
- Partial payments. Prepaid credit balances. Concessions spread across months.
- Unicode names (José Núñez, Zoë Ødegaard, Nguyễn Thị Hoa). Very long names and company names.
- Commercial NNN: CAM/tax/insurance estimates with a year-end reconciliation (true-up charge or credit).

## Corrupted (detected by `data_rules`, fixable with AI)

| Rule (`RuleKey`) | Planted case | Suggested fix |
|---|---|---|
| `residents.possible_duplicate` | Same person, slightly different spelling, same phone | Merge into the older record |
| `leases.end_before_start` | `end_on` < `start_on` | Swap or set end = start + term |
| `leases.rent_outlier` | Rent 10× the unit's market rent (typo) | Divide by 10 |
| `leases.past_end_date` | Month-to-month holdover still marked Active, 1–4 months past its end (6 planted: 2 in p01–p03, 2 elsewhere in Texas, 2 in Atlanta or Phoenix). The generator also leaves 1 on its own: an Active Phoenix lease past its end with its move-out still ahead, so the rule finds 7 | A person picks: mark as ended or switch to month-to-month (approval) |
| `properties.negative_unit_count` | `unit_count` < 0 | Set to the count of units rows |
| `units.orphan_property` | `property_id` points nowhere | Re-link by building/number match |
| `payments.wrong_lease` | Payment posted to a neighbouring lease | Move to the lease whose charge matches the amount |
| `bill_lines.gl_miscoded` | Plumbing repair coded to landscaping | Recode to Repairs & maintenance |
| `bank_transactions.unmatched_deposit` | Deposit with no matching transfer batch | Suggest the closest batch by amount/date |
| `residents.phone_in_email` | Phone number in the email field | Move it to phone; flag email missing |
| `properties.missing_zip_state` | Missing ZIP or state | Fill from city/metro |
| `properties.address_format` | "123 Main St." vs "123 MAIN STREET" | Normalise to USPS style |
| `owner_distributions.rounding_cent` | Statement off by $0.01 | Post a 1-cent adjustment |
| `vendors.unverified_bank_change` | Bank changed, no verification task | Hold payments; create a verification task |
| `documents.import_swapped_columns` | Import where first/last name or rent/deposit are swapped | Swap columns back for the import batch |

Corrupted rows live in base, with workspace_id 'base'. Fixing one writes an overlay row, a `data_fix_log` row with before/after values, and an `audit` row. Base money history is never corrupted in a way that breaks the trust or trial-balance assertions. Money-side cases (wrong lease, rounding cent, unmatched deposit) are planted as offsetting pairs, so totals still tie.
