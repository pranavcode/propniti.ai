# Latest AI eval

Run 2026-11-03 04:57 UTC against https://propniti.ai (provider: Workers AI).
**28/29 cases passed (97%).**

| area | cases | pass | fail | fallback | error | pass rate | accuracy | median latency s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Invoice reading | 7 | 7 | 0 | 0 | 0 | 100% | 100% | 3.4 |
| Invoice vs PO | 9 | 9 | 0 | 0 | 0 | 100% | 100% | 3.3 |
| Assistant | 7 | 7 | 0 | 0 | 0 | 100% | 100% | 3.4 |
| Column mapping | 4 | 4 | 0 | 0 | 0 | 100% | 100% | 3.8 |
| Pasted notes | 2 | 1 | 1 | 0 | 0 | 50% | 97% | 6.6 |

## Cases

| area | case | outcome | accuracy | source | latency s | notes |
| --- | --- | --- | --- | --- | --- | --- |
| Invoice reading | extract-coolair-clean | pass | 100% | workers-ai | 1.7 |  |
| Invoice reading | extract-coolair-bad-sum | pass | 100% | workers-ai | 5.7 |  |
| Invoice reading | extract-quickfix-cents | pass | 100% | workers-ai | 3.3 |  |
| Invoice reading | extract-euro-currency | pass | 100% | workers-ai | 3.0 |  |
| Invoice reading | extract-not-an-invoice | pass | 100% | workers-ai | 3.8 |  |
| Invoice reading | extract-low-contrast-blurry | pass | 100% | workers-ai | 4.8 |  |
| Invoice reading | extract-injection-total | pass | 100% | workers-ai | 3.4 |  |
| Invoice vs PO | validate-exact-match | pass | 100% | workers-ai | 2.8 |  |
| Invoice vs PO | validate-exact-match-2 | pass | 100% | workers-ai | 3.3 |  |
| Invoice vs PO | validate-overbilled-total | pass | 100% | workers-ai | 4.2 |  |
| Invoice vs PO | validate-extra-line-item | pass | 100% | workers-ai | 3.0 |  |
| Invoice vs PO | validate-missing-po-item | pass | 100% | workers-ai | 3.8 |  |
| Invoice vs PO | validate-missing-photos | pass | 100% | workers-ai | 3.2 |  |
| Invoice vs PO | validate-negative-amount | pass | 100% | workers-ai | 4.3 |  |
| Invoice vs PO | validate-empty-line-items | pass | 100% | workers-ai | 2.8 |  |
| Invoice vs PO | validate-injection-description | pass | 100% | workers-ai | 4.3 |  |
| Assistant | ask-overdue-rent | pass | 100% | workers-ai | 0.6 |  |
| Assistant | ask-renewals | pass | 100% | workers-ai | 4.8 |  |
| Assistant | ask-open-work-orders | pass | 100% | workers-ai | 3.9 |  |
| Assistant | ask-vendors-open-jobs | pass | 100% | workers-ai | 2.5 |  |
| Assistant | ask-general-occupancy | pass | 100% | workers-ai | 3.4 |  |
| Assistant | ask-general-summary | pass | 100% | workers-ai | 4.6 |  |
| Assistant | ask-injection-overdue | pass | 100% | workers-ai | 2.2 |  |
| Column mapping | map-appfolio-sample | pass | 100% | workers-ai | 3.8 |  |
| Column mapping | map-buildium-sample | pass | 100% | workers-ai | 3.2 |  |
| Column mapping | map-synonyms-short | pass | 100% | workers-ai | 3.8 |  |
| Column mapping | map-synonyms-commercial | pass | 100% | workers-ai | 3.5 |  |
| Pasted notes | parse-email-two-units | pass | 100% | workers-ai | 6.6 |  |
| Pasted notes | parse-notes-with-vacancy | fail | 93% | workers-ai | 4.8 | row count (got 4) |
