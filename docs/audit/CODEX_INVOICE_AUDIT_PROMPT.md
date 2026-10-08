# AUDIT & VERIFICATION DIRECTIVE FOR CODEX
## Independent Financial & Mathematical Audit of the Invoicing & Pricing Engine
### System: RheinAhr Dienstleistungen GmbH — Medical Staffing Platform (AÜG / Pflege)

---

### 1. MISSION OBJECTIVE & ROLE DEFINITION
You are acting as an **Independent Lead Financial & Systems Auditor**.
Your task is to conduct an uncompromising, end-to-end mathematical, regulatory, and software audit of the invoicing engine in this platform. 

The client is a healthcare and temporary staffing agency (Arbeitnehmerüberlassung im Pflegebereich) in Germany. Real invoices are actively being sent to hospitals, nursing homes, and corporate care facilities (e.g., Alloheim, Korian). 

**Problem Statement:** 
Clients and external accountants are discovering discrepancies in decimal multiplication and rounding on sent invoices (e.g., a printed row showing `12,62 Std.` at `52,80 €` displaying `666,16 €` instead of `666,34 €`, double currency symbols `€ €`, rounding differences at subtotal level, break deduction issues). Management demands a bulletproof, 100% mathematically and legally compliant engine that leaves zero margin for client dispute or tax authority (Finanzamt) audit findings.

You must examine the codebase, run simulated calculation scenarios, expose every hidden flaw or mathematical risk, and provide an actionable, phased remediation plan.

---

### 2. REPOSITORY & CODE CONTEXT
You must inspect and verify the following key files:
- `lib/pricing.ts` — Shift surcharge splitting (`shiftSurchargeHours`), window calculations, holiday logic, `requestNetTotal`.
- `lib/invoice-pdf-builder.ts` — Building printable invoice data (`buildInvoicePdfData`), grouping by worker/qualification, calculating line hours/rates/amounts, frozen snapshot fallback.
- `lib/pdf/invoice.tsx` — React-PDF template rendering invoice tables, subtotals, VAT, and gross totals.
- `app/[locale]/admin/orders/[id]/invoice-actions.ts` — Invoice generation (`generateOrderInvoices`), recalculation/refresh (`refreshInvoice`), cancellation, email dispatch.
- `app/[locale]/admin/clients/[id]/schedule/invoice-actions.ts` — Monthly invoice generation (`generateMonthInvoices`).
- `lib/holidays.ts` — German statutory holiday calculations.
- `lib/pdf/generate-timesheets-pdf.ts` — Shift confirmation sheets (Leistungsnachweise) generation and hour aggregation.

---

### 3. ACCOUNTING & REGULATORY REQUIREMENTS (GERMAN AÜG / BGB / UStG)
Your audit must verify strict adherence to the following rules:

1. **Row Multiplication Integrity (Zeilen-Multiplikationsgenauigkeit):**
   - On German commercial invoices, every line item must satisfy:
     $$\text{Line Amount} = \operatorname{round}_2(\text{Printed Hours} \times \text{Printed Rate})$$
   - If an invoice displays `Stunden: 12,62` and `Preis/Std: 52,80 €`, the printed `Betrag` **MUST be 666,34 €**. It must **NEVER** be calculated from unrounded internal floating point minutes (e.g. $12.616666... \times 52.80 = 666.16$). Any human or ERP software multiplying the visible values must arrive at the exact printed amount to the cent.

2. **Summation & Tax Integrity (Zwischensumme & MwSt):**
   - The Net Subtotal (`Zwischensumme`) must equal the exact sum of all line item amounts:
     $$\text{Zwischensumme} = \sum \text{Line Amount}$$
   - The VAT (`MwSt 19%`) must be calculated as:
     $$\text{MwSt} = \operatorname{round}_2(\text{Zwischensumme} \times 0.19)$$
   - The Final Total (`Endbetrag`) must equal:
     $$\text{Endbetrag} = \text{Zwischensumme} + \text{MwSt}$$
   - No single-cent drift between row sums and printed subtotals is permissible.

3. **Break Deductions (Gesetzliche Pausen nach § 4 ArbZG):**
   - Shifts $\le 6\text{h}$: No mandatory break unless agreed.
   - Shifts $> 6\text{h}$ up to $9\text{h}$: Minimum 30 minutes break.
   - Shifts $> 9\text{h}$: Minimum 45 minutes break.
   - The system allows facilities to specify custom breaks (`breakMinutes`), including `0` (if worker worked through the break without interruption).
   - Verify that `breakMinutes = 0` is respected and not coerced to 30 via `breakMinutes || 30`.

4. **Surcharges (Zuschläge):**
   - **Saturday (Samstag):** Typically 20% to 35% on Saturday calendar hours (00:00–24:00).
   - **Sunday (Sonntag):** Typically 50% to 100% on Sunday calendar hours (00:00–24:00).
   - **Holiday (Feiertag):** Typically 100% to 150% on statutory holidays in the facility's German Bundesland.
   - **Night (Nacht):** Configurable window per facility (e.g., 20:00–06:00, 22:00–06:00, or 23:00–06:00), typically 25%.
   - **Overnight Shifts (Schicht über Mitternacht):** A shift from 21:00 Saturday to 06:00 Sunday must split Saturday night hours vs. Sunday night/early hours correctly.
   - **Concurrency / Precedence (Konkurrenzregeln):** When a statutory holiday falls on a Sunday, does holiday surcharge replace or stack with Sunday surcharge according to the facility contract?

5. **Invoice Immutability vs. Explicit Recalculation:**
   - Once generated, invoice line items and totals must be permanently archived (`snapshotData.isFrozen = true`, `snapshotData.items`) so historical invoices never drift if worker rates or facility settings change later.
   - When an administrator explicitly modifies shift hours and triggers `Rechnung aktualisieren` (`refreshInvoice`), the system must cleanly recompute the line items, unfreeze, re-freeze, and update the database and PDF.

---

### 4. AUDIT CHECKLIST & SIMULATION SCENARIOS
Run concrete numerical simulations on the following test cases and report the exact results:

#### Test Case 1: Irregular Minute Fractions (The "Oso, Majed" Real Case)
- Worker: Qualification rate `52,80 €/h`.
- Shift 1: Saturday 06:05 – 12:53 (Break: 0 min). Duration = 6h 48m = 6.80h. Sat surcharge = 30% (`15,84 €/h`).
- Shift 2: Sunday 15:19 – 21:08 (Break: 0 min). Duration = 5h 49m = 5.816666...h. Sun surcharge = 50% (`26,40 €/h`).
- Total base hours: $6.80 + 5.816666... = 12.616666... \to 12,62\text{h}$.
- **Expected Results:**
  - Base line: $12,62 \times 52,80 = 666,34\text{ \texteuro}$.
  - Sat line: $6,80 \times 15,84 = 107,71\text{ \texteuro}$.
  - Sun line: $5,82 \times 26,40 = 153,65\text{ \texteuro}$.
  - Subtotal: $666,34 + 107,71 + 153,65 = 927,70\text{ \texteuro}$.
  - VAT (19%): $176,26\text{ \texteuro}$.
  - Total: $1.103,96\text{ \texteuro}$.
- **Verify:** Does the code currently produce these exact numbers?

#### Test Case 2: Overnight Weekend Shift (Midnight Transition)
- Shift: Saturday 20:30 to Sunday 06:30 (10 hours, 45 min break).
- Night window: 22:00 to 06:00.
- Sat surcharge: 25%, Sun surcharge: 50%, Night surcharge: 25%.
- Rate: `40,00 €/h`.
- **Verify:** How are break minutes allocated across the Saturday/Sunday and Night/Non-night chunks? Is the calculation stable and deterministic?

#### Test Case 3: Public Holiday on a Sunday
- Date: Easter Sunday (Ostersonntag) or Pentecost (Pfingstsonntag).
- Holiday surcharge: 100%, Sunday surcharge: 50%.
- **Verify:** Does the system charge 100%, 150%, or 50%? Is this consistent with the facility contract?

#### Test Case 4: Multiple Workers & Multiple Qualifications
- 3 Workers on same invoice (2 Pflegefachkräfte, 1 Pflegehelfer).
- Grouping verification: Are assignments grouped correctly per worker and qualification?
- Does the sum of all individual items equal the invoice subtotal to 0.00 € tolerance?

#### Test Case 5: 0-Minute Break Handling
- Verify that `breakMinutes: 0` is never replaced with `30` in any code path (`?? 30` vs `|| 30`).

---

### 5. REQUIRED OUTPUT STRUCTURE
Deliver your findings in the following clear, executive format:

1. **Executive Summary & Honest Reality Check (Status Quo)**
   - Clear verdict: Is the current calculation logic mathematically solid, or are there hidden edge cases that will cause client disputes?
   - Assessment of recent fixes applied (rounding per line item, `€ €` template fix, refresh action).

2. **Deep-Dive Flaw & Vulnerability Report**
   - For every flaw found, provide:
     - Exact File & Line Number.
     - Failure Scenario / Edge Case.
     - Mathematical Proof of the error.
     - Severity: Critical (Causes financial dispute), High (Inconsistent PDF/DB), Medium (Sub-optimal architecture).

3. **Simulation Results Table**
   - A tabular comparison of Expected vs. Actual results across all 5 test cases above.

4. **Phased Remediation Plan (خطة التعديلات المرحلية)**
   - **Phase 1: Immediate Safety Fixes (Zero risk, instant accuracy):** Direct patches to pricing and PDF builder.
   - **Phase 2: Database & Action Synchronization:** Ensuring `netAmount` in DB, `requestNetTotal`, and `buildInvoicePdfData` use identical rounding rules.
   - **Phase 3: Automated Regression & Verification Tests:** Unit tests covering all edge cases to prevent any regression.
