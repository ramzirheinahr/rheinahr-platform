# Qualification catalog and billing rates — implementation plan

## Objective

System Settings becomes the source of truth for the qualifications that may be selected in new work. An administrator can add a qualification, edit its displayed names and default **client billing rate**, and archive it. The existing **Vergütung** page remains the only place to set a client's price override. A qualification's stable code is never reused or changed after creation.

This change must preserve existing orders, workers, rate versions, and issued invoices. It must not silently issue a line at €0.00 when a price is missing.

## Current system and risks

- The six current codes are hard-coded in `lib/validations.ts`, `lib/pricing.ts`, multiple forms, schedule/report filters, and export paths. `Worker.qualification`, `Order.requiredQualification`, and `ClientHourlyRateVersion.qualification` are already strings, so they do not require enum migration.
- `Client.hourlyRates` stores client-specific overrides by qualification code. A missing key means use the platform default. Some client create/edit parsing is still tied to six named fields and must be removed or it can discard dynamic overrides.
- `lib/pricing.ts` currently returns zero for an unknown qualification. This is unsafe in estimates, legacy invoices, and PDF regeneration.
- V2 billing resolves dated, immutable `ClientHourlyRateVersion` records. A qualification added only to the settings list will still fail V2 invoicing until its price has a verifiable dated source.
- Several PDF and UI labels use fixed translations or fixed maps. An archived or newly created qualification must still have a readable historical label.

## Data design

1. Add `QualificationCatalog` with an immutable unique code, German/English/Arabic display names, sort order, active flag, created/updated timestamps, and the current default client billing price stored as **integer cents**. Add an audit event for every mutation. The catalog is an operational selection list, not a replacement for invoice snapshots.
2. Add an append-only `QualificationDefaultRateVersion` (qualification code, cents, valid-from, actor, timestamp, source reference/hash). The effective version is the newest valid-from date at the shift date; old records are never modified.
3. Keep client overrides keyed by the immutable qualification code. The Vergütung page shows the inherited default and an optional override; blank means inherit. Saving a changed override writes an append-only `ClientPricingRateChange` in the same transaction as the editable client profile. It takes effect **today in Berlin**. Past shifts are not silently repriced.
4. Existing contract-specific, frozen client price versions keep precedence over client-wide settings. Resolution order at the shift date: **contract rate → latest dated client edit (including explicit return to default) → older approved general setting → dated platform default**. Ambiguous overlaps or missing rates fail clearly. The chosen source ID, cents, qualification code, and display label are frozen into the invoice snapshot. Issued and sent invoices are never recalculated from current settings.
5. Archiving removes a qualification from new worker/order selectors. It does not delete historic rows or prevent display, PDF access, reprints, or correction workflows for existing orders. A code is never reused. Deletion is implemented as archival even if the UI calls it “remove.”
6. The catalog default is a **customer billing** rate only. Worker payroll rates are separate and are not changed by this feature.

## End-to-end change map

| Area | Required behavior |
| --- | --- |
| System Settings | Add, rename display labels, set/edit default billing rate, reorder, archive/reactivate. New prices take effect today; mutations have audit records. Server-only role checks and Zod validation. |
| Client Vergütung | All active qualifications plus any archived code used by this client; show inherited default and optional client override. Edits take effect today. This page is the only client-price editor. |
| Client create/edit | Stop parsing fixed `ratePflegefachkraft`-style fields and stop overwriting `hourlyRates` when general profile data is saved. |
| Worker forms and assignment | Select active catalog entries for new work; retain existing archived value in edit/view. Server actions reject unknown/inactive codes for new assignments and requests. |
| Admin/client order forms | Load active catalog entries, use their labels and effective rates in estimates; preserve an archived value on existing orders and prohibit silently changing it. |
| Schedule, notebook, reports, exports | Build filters and headings from the catalog. Include archived codes when relevant to the selected historical data; never drop rows because a code is no longer active. |
| Legacy invoice / PDFs / V2 invoice | Use one rate resolver with integer cents; never use zero as a fallback. V2 keeps frozen price provenance. PDF descriptions and finalized totals come from the invoice snapshot, not today's catalog label or price. |
| Localization | Use catalog labels with a safe fallback to the stored code. Do not call `next-intl` with a new dynamic key that may not exist in message files. |

## Migration and release sequence

1. **Inventory and baseline:** capture a count of distinct qualification codes across workers, orders, client override JSON, client rate versions, and invoice snapshots. Detect values outside the initial six and add them to the catalog as inactive or review-required rather than dropping them.
2. **Additive migration:** create catalog and dated default-rate tables, backfill the six existing codes and prices exactly as currently configured, and backfill observed custom codes without guessing a price. Do not alter existing invoices or client overrides.
3. **Read-path migration:** switch selectors, filters, reports, and price preview to catalog reads with explicit missing-price states. Keep old snapshots readable. Run a comparison of a representative set of current invoice drafts before enabling writes.
4. **Write-path migration:** enable settings management and client override editing. Save client rates and an append-only change record in one transaction. Reject stale concurrent edits.
5. **Billing cutover:** connect both invoice paths to the dated resolver, verify price precedence and snapshot/PDF parity, then enable catalog-based selection. No manual V2 approval step is added merely because a default rate exists.
6. **Production verification:** apply database migration first, deploy code second, then verify one old invoice, one current invoice, one new qualification with inherited default, one client override, one archived qualification, and one contract-specific price. Hold outbound emails until those checks pass.

No deployment or production data change is part of this planning document.

## Minimum acceptance tests

- Add a new specialty at €40.00, select it in a worker and order, preview/invoice 2.50 hours as €100.00 net before surcharges and tax.
- Override the same specialty for one client at €42.00; that client invoices at €105.00 net while another remains at €100.00.
- Change the global default today; earlier shifts retain the earlier version, later shifts use the new version. Contract-specific price still wins. Future scheduling is outside this delivery.
- Reject a missing, invalid, negative, or non-cent price before invoice issuance; never create an invoice with a fabricated zero rate.
- Archive and reactivate a specialty; new selection changes, while old workers/orders/invoices/exports continue to show it.
- Confirm that editing a client's address or other profile fields does not erase any price overrides.
- Verify German, English, and Arabic names; invoice PDF and totals match the saved snapshot after later label/rate edits.
- Test concurrent edits, duplicate codes, rate interval overlaps, and mixed old/new invoice data.
