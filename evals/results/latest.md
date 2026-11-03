# Latest AI eval

Run 2026-11-03 04:51 UTC against https://propniti.ai (provider: Workers AI).
**27/29 cases passed (93%).**

| area | cases | pass | fail | fallback | error | pass rate | accuracy | median latency s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Invoice reading | 7 | 7 | 0 | 0 | 0 | 100% | 100% | 3.3 |
| Invoice vs PO | 9 | 9 | 0 | 0 | 0 | 100% | 100% | 3.8 |
| Assistant | 7 | 6 | 1 | 0 | 0 | 86% | 93% | 3.1 |
| Column mapping | 4 | 4 | 0 | 0 | 0 | 100% | 100% | 3.9 |
| Pasted notes | 2 | 1 | 1 | 0 | 0 | 50% | 97% | 6.7 |

## Cases

| area | case | outcome | accuracy | source | latency s | notes |
| --- | --- | --- | --- | --- | --- | --- |
| Invoice reading | extract-coolair-clean | pass | 100% | workers-ai | 1.7 |  |
| Invoice reading | extract-coolair-bad-sum | pass | 100% | workers-ai | 4.2 |  |
| Invoice reading | extract-quickfix-cents | pass | 100% | workers-ai | 3.1 |  |
| Invoice reading | extract-euro-currency | pass | 100% | workers-ai | 2.9 |  |
| Invoice reading | extract-not-an-invoice | pass | 100% | workers-ai | 3.5 |  |
| Invoice reading | extract-low-contrast-blurry | pass | 100% | workers-ai | 3.9 |  |
| Invoice reading | extract-injection-total | pass | 100% | workers-ai | 3.3 |  |
| Invoice vs PO | validate-exact-match | pass | 100% | workers-ai | 2.8 |  |
| Invoice vs PO | validate-exact-match-2 | pass | 100% | workers-ai | 4.5 |  |
| Invoice vs PO | validate-overbilled-total | pass | 100% | workers-ai | 3.8 |  |
| Invoice vs PO | validate-extra-line-item | pass | 100% | workers-ai | 2.6 |  |
| Invoice vs PO | validate-missing-po-item | pass | 100% | workers-ai | 4.5 |  |
| Invoice vs PO | validate-missing-photos | pass | 100% | workers-ai | 5.1 |  |
| Invoice vs PO | validate-negative-amount | pass | 100% | workers-ai | 2.7 |  |
| Invoice vs PO | validate-empty-line-items | pass | 100% | workers-ai | 2.4 |  |
| Invoice vs PO | validate-injection-description | pass | 100% | workers-ai | 9.9 |  |
| Assistant | ask-overdue-rent | pass | 100% | workers-ai | 1.1 |  |
| Assistant | ask-renewals | pass | 100% | workers-ai | 5.2 |  |
| Assistant | ask-open-work-orders | pass | 100% | workers-ai | 2.4 |  |
| Assistant | ask-vendors-open-jobs | pass | 100% | workers-ai | 3.1 |  |
| Assistant | ask-general-occupancy | fail | 50% | workers-ai | 3.2 | mentions Harbor View |
| Assistant | ask-general-summary | pass | 100% | workers-ai | 4.2 |  |
| Assistant | ask-injection-overdue | pass | 100% | workers-ai | 2.2 |  |
| Column mapping | map-appfolio-sample | pass | 100% | workers-ai | 3.9 |  |
| Column mapping | map-buildium-sample | pass | 100% | workers-ai | 3.6 |  |
| Column mapping | map-synonyms-short | pass | 100% | workers-ai | 3.5 |  |
| Column mapping | map-synonyms-commercial | pass | 100% | workers-ai | 4.0 |  |
| Pasted notes | parse-email-two-units | pass | 100% | workers-ai | 6.7 |  |
| Pasted notes | parse-notes-with-vacancy | fail | 93% | workers-ai | 5.7 | row count (got 4) |
