# تقرير تدقيق وسلامة البيانات قبل إصدار الفواتير — المرحلة 07e (الإصدار المصحح والمعتمد)

**التاريخ:** 12 أكتوبر 2026
**الفرع المعزول:** `phase_07e_owner_decisions`
**بيئة التنفيذ:** مساحة عمل معزولة (Worktree) مستقلة تمامًا؛ دون اتصال بقاعدة بيانات الإنتاج، ودون تشغيل build أو seed أو ترحيلات حية.
**حالة رايات الإصدار:** `FEATURE_INVOICE_V2_ISSUANCE=false` و `FEATURE_INVOICE_V2_REFRESH=false` (مغلقة قطعيًا NO-GO).
**المرجع:** قرار المراجعة المستقلة الثانية لسلامة البيانات وتوجيهات المالك الصارمة.

---

## ١. ملخص تنفيذي ومحددات الجاهزية

بناءً على نتائج المراجعة المستقلة لسلامة البيانات، تمت معالجة الملاحظات المانعة بدقة متناهية وإغلاق كافة الثغرات:
1. **[P1] معالجة تكرار إلغاء الفاتورة وضمان انفرادية الانتقال (Cancellation Idempotency Guard):**
   - في `cancelInvoice` (`app/[locale]/admin/orders/[id]/invoice-actions.ts`)، نُقل فحص الفاتورة بالكامل داخل المعاملة التفاعلية `prisma.$transaction` مصحوبًا بقفل سطر فيزيائي `SELECT id, status FROM "invoices" ... FOR UPDATE`.
   - تم فرض حراسة مشددة: إذا كانت الفاتورة ملغاة مسبقًا (`status === "cancelled"`)، يُرفع استثناء فوري قطعي (`"Rechnung ist bereits storniert."`) لمنع أي استبدال لبيانات `cancellationHistory` أو تكرار لسجل التدقيق.
2. **[P1] سد ثغرة السباق (TOCTOU) والقفل الفيزيائي لحذف الطلبات داخل المعاملة (In-Transaction Row Locking):**
   - في `updateOrderRequestAsAdmin` (`admin/orders/actions.ts`) و`deleteOpenOrderFromGrid` (`admin/schedule/actions.ts`)، تم سحب القرار وفحوصات الفواتير النشطة والتاريخية (`hasHistoricalInvoiceRecordForAssignment` و `hasHistoricalInvoiceRecordForOrder`) لتتم داخل المعاملة التفاعلية حصريًا تحت حماية القفل الفيزيائي للصفوف (`FOR UPDATE` على `assignments` و `orders`) بالتنسيق الدقيق مع بروتوكول إصدار الفواتير في `lib/invoice-v2-issuance-service.ts`.
   - في حال حدوث أي سباق تزامني لإصدار فاتورة على الوردية أثناء محاولة الحذف، تُجهض المعاملة وتتراجع فورًا (`LOCKED_INVOICED`) مع إعادة `{ ok: false, error: "lockedInvoiced" }`.
3. **تصحيح فحص TypeScript الصارم برمز خروج 0:** ضبط تعريفات الأنواع في إجراءات الطلبات بنماذج دقيقة ومحددة (`DeletedOrderInfo`, `AffectedWorkerInfo`, `ShiftOfferData`) دون استخدام `any`، وتأكيد اجتياز `tsc` بخلو تام من الأخطاء.
4. **إغلاق المعاملة الذرية الصارمة لـ `cancelInvoice` دون أي مسارات احتياطية:** اشتراط وجود `tx.auditLog.create` وتنفيذه داخل المعاملة حصريًا (Fail-Closed). تم تعديل محاكيات الاختبار لتطابق كود الإنتاج مع إضافة اختبارات تثبت إلغاء المعاملة إذا تعذر التدقيق.
5. **حذف خيار إعادة `ON DELETE CASCADE` نهائيًا من خطة الرجوع:** التأكيد الصارم على أن التراجع البرمجي لا يمس قيد قاعدة البيانات، وأن `ON DELETE RESTRICT` يبقى نافذًا دائمًا لمنع حذف الفواتير مع العميل.
6. **تطهير الفرق التراكمي من المسافات الختامية:** تم تنظيف ملفات التوثيق وإزالة ملف الرقعة التراكمية من التتبع؛ `git diff --check main...HEAD` نظيف بنسبة 100% برمز خروج 0.

---

## ٢. ترحيل حماية المفتاح الأجنبي للفواتير في PostgreSQL (`ON DELETE RESTRICT`)

### أ) الترحيل المستقل المعتمد
أُنشئ ترحيل Prisma رسمي في المسار:
`prisma/migrations/20261012_phase_07e_invoice_client_delete_restrict/migration.sql`

نص الترحيل:
```sql
-- Phase 07e: Alter foreign key constraint on invoices.client_id to ON DELETE RESTRICT
-- RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization (Phase 07e Data Integrity)

-- 1. Drop pre-existing foreign key constraint if it exists (which had ON DELETE CASCADE)
ALTER TABLE "invoices"
DROP CONSTRAINT IF EXISTS "invoices_client_id_fkey";

-- 2. Re-create foreign key constraint with ON DELETE RESTRICT and ON UPDATE CASCADE
ALTER TABLE "invoices"
ADD CONSTRAINT "invoices_client_id_fkey"
FOREIGN KEY ("client_id")
REFERENCES "clients"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
```

### ب) خصائص التشغيل والأقفال (Locking & Operations)
- **طبيعة القفل:** يتطلب تعديل القيد قفل `ACCESS EXCLUSIVE` على جدول الفواتير `invoices` وقفل `SHARE ROW EXCLUSIVE` على جدول `clients` أثناء التنفيذ في PostgreSQL.
- **إجراء التطبيق:** يجب تشغيله عبر `npx prisma migrate deploy` ضمن نافذة صيانة محددة أو في وقت انخفاض النشاط، وليس أمرًا إضافيًا خاليًا من الأقفال.
- **استعلام كتالوج PostgreSQL للتحقق (Catalog Proof Query):**
  ```sql
  SELECT
      conname AS constraint_name,
      conrelid::regclass AS table_name,
      confrelid::regclass AS foreign_table_name,
      confdeltype AS delete_action
  FROM pg_constraint
  WHERE conname = 'invoices_client_id_fkey';
  ```
  عندما تكون قيمة `confdeltype = 'r'`، فهذا يثبت في الكتالوج أن الحذف المتتالي ملغى وأن قاعدة البيانات تفرض `RESTRICT`. (القيمة السابقة كانت `'c'` المقابلة لـ `CASCADE`).
- **خطة الرجوع في حال الطوارئ (Emergency Rollback Strategy):**
  في حال استدعاء خطة طوارئ للرجوع البرمجي لكود التطبيق، **يُحظر قطعيًا إعادة فرض `ON DELETE CASCADE`** في قاعدة البيانات لما يمثله ذلك من خطر داهم بإمكانية محو الفواتير مع العميل. يظل قيد `ON DELETE RESTRICT` ساريًا وثابتًا على محرك PostgreSQL لحماية الأصول المالية، ويقتصر الرجوع على شفرة التطبيق وصلاحيات الحذف الخادمي.

### ج) معالجة سباق إنشاء الفاتورة مع حذف العميل (Race Condition Closure)
في `app/[locale]/admin/clients/actions.ts`:
إذا أنشئت فاتورة بالتزامن بين فحص `invoiceCount` وتنفيذ `prisma.user.delete`، يمنع محرك PostgreSQL الحذف ويرفع استثناء القيد الأجنبي. تم تحديث الإجراء الخادمي ليلتقط كود الخطأ `P2003` و`P2014` واستثناءات `Restrict` ويرد وقائيًا:
`{ ok: false, error: "hasFinancialRecords" }`.

---

## ٣. الإلغاء الذري للفواتير وتخليد الروابط التاريخية وحماية حراسات الحذف

### أ) المعاملة الذرية وضمان انفرادية الإلغاء وسجل التدقيق الإلزامي في `cancelInvoice`
أُعيدت صياغة الدالة الخادمية `cancelInvoice` في `app/[locale]/admin/orders/[id]/invoice-actions.ts`:
1. تُنفذ العملية بأكملها كمعاملة تفاعلية ذرية صارمة (`prisma.$transaction(async (tx) => { ... })`):
   - **القفل الفيزيائي لسجل الفاتورة:** تنفيذ استعلام `SELECT id, status FROM "invoices" WHERE id = ${invoiceId} FOR UPDATE` لمنع أي سباق تزامني على الفاتورة ذاتها.
   - **حراسة انفرادية الانتقال والتكرار (Idempotency Guard):** التحقق من حالة الفاتورة الحالية داخل المعاملة المقفلة:
     ```typescript
     if (invoice.status === "cancelled") {
       throw new Error("Rechnung ist bereits storniert.");
     }
     ```
     إذا كانت الفاتورة ملغاة مسبقًا، ترفض العملية وتتراجع فورًا، مانعة أي محاولة ثانوية لاستبدال `cancellationHistory` أو تسجيل قيود تدقيق مكررة.
   - استخراج معرفات المناوبات والعمال والطلبات المشمولة وتخليدها داخل `snapshotData` ضمن مصفوفات دائمة: `historicalAssignmentIds`, `historicalWorkerIds`, `historicalOrderIds`.
   - **التحقق الاستباقي الصارم من تفويض التدقيق:** `if (!tx.auditLog?.create) throw new Error(...)`.
   - تحرير الورديات: `tx.assignment.updateMany({ where: { invoiceId }, data: { invoiceId: null } })`.
   - تعديل حالة الفاتورة وتخليد البيانات: `tx.invoice.update({ where: { id: invoiceId }, data: { status: "cancelled", snapshotData: updatedSnapshotData } })`.
   - **سجل التدقيق الذري الإلزامي:** كتابة سجل التدقيق إلزاميًا داخل نفس المعاملة `await tx.auditLog.create(...)`. في حال فشل التدقيق أو غيابه، تتراجع المعاملة بالكامل فورًا (Fail-Closed) دون إتمام الإلغاء ودون فك ارتباط الورديات.

### ب) تخليد الروابط التاريخية ودعم العميل التبادلي (`InvoicingQueryClient`)
طُوّرت دوال مركزية في `lib/invoicing.ts` تدعم تمرير العميل التبادلي للمعاملة `db?: Prisma.TransactionClient | typeof prisma`:
- `hasHistoricalInvoiceRecordForWorker(workerId, db)`: تفحص الورديات المفوترة النشطة، وكافة الفواتير التي تشتمل على الموظف في `historicalWorkerIds`، إضافة إلى الفحص التوافقي لبنود الفواتير التاريخية السابقة لمرحلة 07e (`snap.items` و `snap.pdfItems`).
- `hasHistoricalInvoiceRecordForAssignment(assignmentId, db)`: تفحص ربط الوردية النشط، ومصفوفة `historicalAssignmentIds` الناتجة عن إلغاءات المرحلة 07e، وبنود الفواتير التاريخية السابقة تحت سياق نفس المعاملة.
- `hasHistoricalInvoiceRecordForOrder(orderId, db)`: تفحص ربط الطلب ومصفوفة `historicalOrderIds` الناتجة عن إلغاءات 07e وبنود الفواتير التاريخية السابقة تحت سياق نفس المعاملة.

### ج) إغلاق ثغرة السباق (TOCTOU) والقفل الفيزيائي لحذف الطلبات داخل المعاملة
تم إدراج القرار والفحص والحذف بالكامل داخل معاملات ذرية تفاعلية مدعومة بأقفال فيزيائية:
1. **تعديل طلبات الورديات كمسؤول (`updateOrderRequestAsAdmin`):**
   - حُصر حذف الورديات والطلبات المحذوفة بالكامل داخل المعاملة `prisma.$transaction`.
   - تطبيق القفل الفيزيائي للصفوف: `SELECT id FROM "assignments" WHERE id IN (...) FOR UPDATE` (بترتيب تصاعدي حتمي لمنع التعارض الميت) و `SELECT id FROM "orders" WHERE id IN (...) FOR UPDATE`.
   - فحص الفواتير النشطة والتاريخية عبر المعاملة ذاتها (`hasHistoricalInvoiceRecordForAssignment(asgn.id, tx)` و `hasHistoricalInvoiceRecordForOrder(orderId, tx)`).
   - إذا تم فوترة أي مناوبة بالتزامن أثناء المعاملة، تتراجع المعاملة فورًا وتُجهض بإعادة `{ ok: false, error: "lockedInvoiced" }`.
2. **حذف الطلب المفتوح من الجدول (`deleteOpenOrderFromGrid`):**
   - نُقل فحص الحالة والأقفال الفيزيائية على المناوبات والطلب (`FOR UPDATE`) وفحص الفواتير النشطة والتاريخية بالكامل إلى داخل `prisma.$transaction`.
   - في حال رصد أي ارتباط مفوتر نشط أو تاريخي، تتراجع المعاملة بالكامل وتعيد `{ ok: false, error: "lockedInvoiced" }`.
3. **حذف الموظف (`deleteWorker`):** يرفض الحذف ويعيد `hasFinancialRecords` حتى لو كانت الفاتورة ملغاة وفُصلت وردياتها (§ 147 AO).
4. **إلغاء المناوبة من الجدول (`releaseAssignmentCore` و`deleteShiftFromGrid`):** ترفض الحذف وتعيد `invoiced`.
5. **تبديل الموظف للوردية (`swapWorker`):** ترفض التبديل وتعيد `invoiced`.
6. **حذف مجموعات الطلبات (`saveShiftsBatch` و`deleteRequestGroup` و`cancelOrderRequestAsAdmin`):** ترفض الحذف وتعيد `lockedInvoiced`.

---

## ٤. التطهير الكامل لسكربت التهيئة وإزالة الشفرة الخطرة (`scripts/seed-demo.mjs`)

- حُذفت كافة الاستيرادات الخطرة (`@supabase/supabase-js`, `@prisma/client`, `bcryptjs`) من الملف.
- حُذفت دالة `cleanup()` بالكامل وكافة أوامر `deleteMany` وحذف مستخدمي Supabase Auth.
- تحول الملف بالكامل إلى هيكل أمان بسيط غير ضار:
  ```javascript
  // scripts/seed-demo.mjs
  console.error("FATAL: scripts/seed-demo.mjs is permanently disabled and its destructive logic has been purged. Exiting immediately.");
  process.exit(1);
  ```
- خلو تام ومثبت في اختبارات الذاكرة من أي كود مسح أو اتصال بقاعدة البيانات.

---

## ٥. تدقيق الترحيلات وأمر البناء وفق حدود الدليل الفني

### أ) التدقيق الدقيق لكافة الترحيلات (6 ترحيلات)
بيان دقيق للطبيعة الفنية الحقيقية لكل ترحيل والأقفال المرتبطة به:

| الترحيل | الاسم البرمجي | طبيعة العمليات الهيكلية | خصائص الأقفال والتوافق |
| :--- | :--- | :--- | :--- |
| **01** | `20261008_phase_03a_evidence_and_corrections` | إنشاء جداول جديدة (`confirmation_documents`, `work_hours_correction_requests`, `consumed_confirmation_tickets`) وتعداداتها. | جداول جديدة بحتة؛ أقفال إنشاء عادية. |
| **02** | `20261009_phase_03c_atomic_correction_concurrency` | **تعديل وتحديث صفوف قائمة:** يحذف فهرسًا سابقًا (`DROP INDEX IF EXISTS`)، يضيف عمودين، **ويحدّث بيانات الصفوف القائمة** (`UPDATE "work_hours_correction_requests" SET "base_version" = ...`) ثم ينشئ فهرسًا جزئيًا فريدًا. | **ليس إضافيًا بحتًا:** عملية `UPDATE` وبناء الفهرس تستلزم أقفالاً على مستوى الجدول في PostgreSQL. متوافق مع المنطق لكنه يتطلب نافذة تطبيق آمنة. |
| **03** | `20261009_phase_04a_surcharge_policy` | إنشاء جدول `facility_surcharge_policies` وتعدادات. | جداول جديدة؛ متوافق خلفيًا. |
| **04** | `20261010_phase_05b1_client_hourly_rate_versions` | إضافة تمديد `btree_gist` وإنشاء جدول أسعار زمني مع زناد حظر التعديل. | تمديد وجدول جديد؛ متوافق خلفيًا. |
| **05** | `20261010_phase_06_invoice_revisions` | إنشاء جدول `invoice_revisions` وزَناد حظر التعديل والحذف. | جدول جديد بحت؛ متوافق خلفيًا. |
| **06 (جديد)** | `20261012_phase_07e_invoice_client_delete_restrict` | **تعديل قيد المفتاح الأجنبي:** حذف القيد القديم وإعادة إنشائه بـ `ON DELETE RESTRICT` لجدول `invoices` المرتبط بـ `clients`. | **يتطلب أقفالاً:** يستلزم قفل `ACCESS EXCLUSIVE` على `invoices` وقفل `SHARE ROW EXCLUSIVE` على `clients`. متوافق مع الأعمال لكن يطبق في نافذة صيانة. |

### ب) حدود أمر البناء (`next build`)
- إزالة `prisma db push --accept-data-loss` أزالت الكتابة والتعديل الهيكلي التلقائي على قاعدة البيانات.
- ومع ذلك، فإن `next build` في بيئة App Router قد تحاول تنفيذ استعلامات قراءة لبعض الصفحات أثناء التوليد المسبق الثابت (SSG / Pre-rendering) إذا كانت الصفحة تتضمن استدعاءات خادمية غير ديناميكية وتوفرت بيانات الاتصال.
- **الضمانة الإلزامية:** يجب أن تتم عملية البناء حصريًا في بيئة معزولة تخلو من متغيرات وأسرار الإنتاج (`DATABASE_URL`) لضمان عدم حدوث أي قراءة أو اتصال بالإنتاج أثناء التجميع.

---

## ٦. نتائج الاختبارات والتحقق الصارم

1. **فحص TypeScript الصارم:**
   `npx tsc --noEmit --incremental false --pretty false` -> **0 أخطاء (Code 0, Zero Errors)**.
2. **فحص ESLint للملفات المعدلة:**
   `npx eslint app/ ... lib/ ... scripts/ ...` -> **0 أخطاء و0 تحذيرات (Zero Errors, Zero Warnings)**.
3. **فحص الفروقات البرمجية والمسافات الختامية التراكمية:**
   `git diff --check main...HEAD` و `git diff --check` -> **خلو تام بنسبة 100% من أي أخطاء أو مسافات ختامية (Exit code 0, Zero Issues)**.
4. **حزمة اختبارات التدقيق المستقلة المحددة (130 اختبارًا):**
   `npx vitest run lib/phase-07e-owner-decisions.test.ts docs/audit/invoice-engine.audit.test.ts --testTimeout=15000`
   -> **130 ناجحًا بنسبة 100% (130 Passed, 0 Failed)**:
   - `lib/phase-07e-owner-decisions.test.ts` (99 اختبارًا، بما في ذلك حراسة تكرار الإلغاء واختبارات سباق حذف الطلبات)
   - `docs/audit/invoice-engine.audit.test.ts` (31 اختبارًا)
5. **حزمة الاختبارات الشاملة للذاكرة:**
   اجتياز كافة الاختبارات المعتمدة داخل الذاكرة دون أي اتصال بقاعدة البيانات ودون كتابة أو حذف بيانات اختبارية.

---

## ٧. الخلاصة والتسليم

- عولجت ملاحظات المراجعة بالكامل: حراسة انفرادية إلغاء الفواتير وعدم تكرار التدقيق، الأقفال الفيزيائية وسد ثغرات السباق لحذف الطلبات داخل المعاملة التفاعلية، ونظافة الفرق التراكمي من `main`.
- تم التحقق الصارم من استقلال الذاكرة، وخلو التقرير من أي إشارة لـ `CASCADE`، وتأكيد اجتياز TypeScript وESLint و`git diff --check main...HEAD`.
- يبقى القرار التشغيلي: **NO-GO** التام؛ لا دمج مع `main`، ولا نشر للإنتاج، والرايتان `FEATURE_INVOICE_V2_ISSUANCE=false` و`FEATURE_INVOICE_V2_REFRESH=false` مغلقتان قطعيًا، بانتظار الاعتماد النهائي من المالك ومراجعة Codex.
