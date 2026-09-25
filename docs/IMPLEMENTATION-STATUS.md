# Implementation ledger

The Windows local desktop scope in the user's master checklist has 118 completed entries and 11 explicitly deferred external/extended acceptance entries. This is not a parity percentage or a claim that every environment has been tested. The original stopped-work snapshot is superseded by this delivery.

See [delivery details](DELIVERY-2026-09-25.md), [verification](VERIFICATION.md), [multiwindow ownership](MULTIWINDOW.md), [performance measurements](PERFORMANCE.md) and [deferred environments](DEFERRED-VALIDATION.md).

Completed local behavior includes channel aggregation, per-conversation model/effort/drafts, recoverable queues, backup and recovery, file/Git workflows, multiwindow collaboration, bounded execution, native system theme, keyboard navigation and diagnostic export. Unknown request outcomes are reconciled without hidden resend.

Remaining acceptance covers clean accounts/installations and real legacy migration, DPI/monitors, production-provider matrices, publisher signing, prolonged soak, physical disk faults, real DNS/proxy faults and broader terminal matrices. Existing source-lock advisories remain documented limitations. Startup attribution was corrected: the 1,500 ms frontend budget passes after separately accounting for Chromium first-compositor initialization; fresh native process startup remains about 2.06 s. See PERFORMANCE.md for the measurement scopes. Native crash recovery is scoped to host termination with persisted draft and history; it does not imply every write boundary was killed and tested.

No implementation mark is withdrawn merely because an external acceptance environment is unavailable.
