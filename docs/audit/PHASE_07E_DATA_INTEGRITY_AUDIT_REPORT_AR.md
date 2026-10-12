# تقرير تدقيق وسلامة البيانات قبل إصدار الفواتير — المرحلة 07e (الإصدار المصحح والمعتمد)

**التاريخ:** 12 أكتوبر 2026  
**الفرع المعزول:** `phase_07e_owner_decisions`  
**بيئة التنفيذ:** مساحة عمل معزولة (Worktree) مستقلة تمامًا؛ دون اتصال بقاعدة بيانات الإنتاج، ودون تشغيل build أو seed أو ترحيلات حية.  
**حالة رايات الإصدار:** `FEATURE_INVOICE_V2_ISSUANCE=false` و `FEATURE_INVOICE_V2_REFRESH=false` (مغلقة قطعيًا NO-GO).  
**المرجع:** قرار المراجعة المستقلة لسلامة البيانات وتوجيهات المالك الصارمة.

---

## ١. ملخص تنفيذي ومحددات الجاهزية

بناءً على نتائج المراجعة المستقلة لسلامة البيانات، تمت معالجة النقاط المانعة الثلاث بدقة صارمة وتصحيح التقرير الفني:
1. **ترحيل PostgreSQL صريح لقيد المفتاح الأجنبي للفواتير:** إنشاء ترحيل Prisma مستقل يغير قيد `invoices.client_id` إلى `ON DELETE RESTRICT` على محرك قاعدة البيانات، مع معالجة سباق حذف العميل برمجياً بالتقاط استثناءات القيود `P2003/P2014`.
2. **إلغاء ذري للفواتير مع التدقيق وحفظ الروابط التاريخية:** جعل `cancelInvoice` معاملة ذرية متكاملة تشمل كتابة سجل التدقيق داخل المعاملة، وتجميد مراجع غير قابلة للتغيير (`historicalAssignmentIds`, `historicalWorkerIds`, `historicalOrderIds`) في `snapshotData`، وتحديث كافة حراسات الحذف لتقرأ هذا التاريخ وتحظر حذف أي موظف أو وردية مرتبطة بفاتورة ملغاة.
3. **تطهير كامل لسكربت التهيئة:** إزالة كافة أوامر المسح الجماعي (`deleteMany`) وحذف مستخدمي Supabase Auth وكافة استيرادات المكتبات من `scripts/seed-demo.mjs`، وتحويل الملف إلى هيكل أمان مغلق قطعيًا.
4. **تصحيح توصيف الترحيلات وأمر البناء:** بيان دقيق لخصائص الأقفال والتحديثات في الترحيلات (خاصة الترحيل 03c والترحيل 07e الجديد)، وتوضيح حدود عزل أمر البناء `next build` باشتراط خلو بيئة البناء من أسرار الإنتاج لمنع أي قراءات ثابتة محتملة.

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
- **كود التراجع في حال الطوارئ (Rollback SQL):**
  ```sql
  ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_client_id_fkey";
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ```

### ج) معالجة سباق إنشاء الفاتورة مع حذف العميل (Race Condition Closure)
في `app/[locale]/admin/clients/actions.ts`:
إذا أنشئت فاتورة بالتزامن بين فحص `invoiceCount` وتنفيذ `prisma.user.delete`، يمنع محرك PostgreSQL الحذف ويرفع استثناء القيد الأجنبي. تم تحديث الإجراء الخادمي ليلتقط كود الخطأ `P2003` و`P2014` واستثناءات `Restrict` ويرد وقائيًا:
`{ ok: false, error: "hasFinancialRecords" }`.

---

## ٣. الإلغاء الذري للفواتير وتخليد الروابط التاريخية وحماية حراسات الحذف

### أ) المعاملة الذرية وسجل التدقيق الإلزامي في `cancelInvoice`
أُعيدت صياغة الدالة الخادمية `cancelInvoice` في `app/[locale]/admin/orders/[id]/invoice-actions.ts`:
1. تُستخرج معرفات المناوبات والموظفين والطلبات المشمولة بالفاتورة قبل الإلغاء.
2. تُدمج في `snapshotData` مع مصفوفات تاريخية دائمة: `historicalAssignmentIds`, `historicalWorkerIds`, `historicalOrderIds` وتوثيق واقعة الإلغاء (`cancellationHistory`).
3. تُنفذ العملية كمعاملة تفاعلية ذرية واحدة (`prisma.$transaction(async (tx) => { ... })`):
   - تحرير الورديات: `tx.assignment.updateMany({ where: { invoiceId }, data: { invoiceId: null } })`.
   - تعديل حالة الفاتورة وتخليد البيانات: `tx.invoice.update({ where: { id: invoiceId }, data: { status: "cancelled", snapshotData: updatedSnapshotData } })`.
   - **سجل التدقيق الذري:** كتابة سجل التدقيق داخل المعاملة `tx.auditLog.create(...)`. في حال فشل التدقيق، تتراجع المعاملة بالكامل فورًا (Fail-Closed) ولا يتم إلغاء الفاتورة دون تدقيق.
   - يتضمن الكود معالجة توافقية لبيئات الاختبار التي تحاكي معاملات المصفوفة، مع ضمان عدم ابتلاع أخطاء التدقيق الحقيقية.

### ب) تخليد الروابط التاريخية وتحديث حراسات الحذف
طُوّرت دوال مركزية في `lib/invoicing.ts`:
- `hasHistoricalInvoiceRecordForWorker(workerId)`: تفحص الورديات المفوترة النشطة، وكافة الفواتير (بما فيها الملغاة) التي تشتمل على الموظف في `historicalWorkerIds` أو بنود الفاتورة.
- `hasHistoricalInvoiceRecordForAssignment(assignmentId)`: تفحص ربط الوردية النشط، وكافة الفواتير التي تشتمل على الوردية في `historicalAssignmentIds` أو البنود.

### ج) حظر الحذف للموظفين والورديات المرتبطة بفواتير ملغاة
تم ربط هذه الفحوصات في كافة مسارات الحذف:
1. **حذف الموظف (`deleteWorker`):** يرفض الحذف ويعيد `hasFinancialRecords` حتى لو كانت الفاتورة ملغاة وفُصلت وردياتها، لحماية سجلات الإثبات والاحتفاظ المالي (§ 147 AO).
2. **إلغاء المناوبة من الجدول (`releaseAssignmentCore` و`deleteShiftFromGrid`):** ترفض الحذف وتعيد `invoiced` إذا كانت المناوبة مسجلة في أي فاتورة تاريخية أو ملغاة.
3. **تبديل الموظف للوردية (`swapWorker`):** ترفض التبديل وتعيد `invoiced` إذا كانت الوردية مرتبطة بسجل فاتورة ملغاة.
4. **حذف مجموعات الطلبات (`saveShiftsBatch` و`deleteRequestGroup` و`cancelOrderRequestAsAdmin`):** ترفض الحذف وتعيد `lockedInvoiced` عند وجود مناوبات تاريخية ملغاة.

---

## ٤. التطهير الكامل لسكربت التهيئة وإزالة الشفرة الخطرة (`scripts/seed-demo.mjs`)

- **الوضع السابق:** كان السكربت يوقف التشغيل في السطر 6، لكن جسم الملف كان يحتوي على كود المسح الجماعي `prisma.*.deleteMany({})` وحذف مستخدمي Supabase Auth.
- **الإجراء المتخذ:**
  - حُذفت كافة الاستيرادات الخطرة (`@supabase/supabase-js`, `@prisma/client`, `bcryptjs`) من الملف.
  - حُذفت دالة `cleanup()` بالكامل وكافة أوامر `deleteMany` و`deleteUser`.
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
تصحيحًا للوصف السابق، نوضح هنا الطبيعة الفنية الحقيقية لكل ترحيل والأقفال المرتبطة به:

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
   `npx tsc --noEmit --incremental false --pretty false` -> **0 أخطاء (Zero Errors)**.
2. **فحص ESLint للملفات المعدلة:**
   `npx eslint app/ ... lib/ ... scripts/ ...` -> **0 أخطاء و0 تحذيرات (Zero Errors, Zero Warnings)**.
3. **فحص الفروقات البرمجية:**
   `git diff --check` -> **خلو تام من أي أخطاء أو علامات غير مرغوبة**.
4. **حزمة اختبارات التدقيق المستقلة المحددة (124 اختبارًا):**
   `npx vitest run lib/phase-07e-owner-decisions.test.ts docs/audit/invoice-engine.audit.test.ts --testTimeout=15000`
   -> **124 ناجحًا (124 Passed, 0 Failed)**.
5. **حزمة الاختبارات الشاملة للمنظومة (257 اختبارًا في 6 أجنحة):**
   - `lib/phase-07e-owner-decisions.test.ts` (93 اختبارًا ناجحًا)
   - `lib/invoice-v2-refresh-service.test.ts` (55 اختبارًا ناجحًا)
   - `lib/invoice-v2-issuance-service.test.ts` (50 اختبارًا ناجحًا)
   - `docs/audit/invoice-engine.audit.test.ts` (31 اختبارًا ناجحًا)
   - `lib/cancelled-invoices-phase-07b.test.ts` (21 اختبارًا ناجحًا)
   - `docs/audit/cross-phase-integration.audit.test.ts` (7 اختبارات ناجحة)
   -> **257 ناجحًا بنسبة 100% (257 Passed, 0 Failed)**.

---

## ٧. الخلاصة والتسليم

- عولجت النقاط المانعة الثلاث بالكامل، وتصحح التقرير ليصف الترحيلات وعملية البناء بدقة علمية واقعية.
- كافة التحققات نُفذت في الذاكرة دون أي مساس بالإنتاج أو كتابة بيانات تجريبية.
- يبقى القرار التشغيلي: **NO-GO** التام؛ لا دمج مع `main`، ولا نشر للإنتاج، والرايتان `FEATURE_INVOICE_V2_ISSUANCE=false` و`FEATURE_INVOICE_V2_REFRESH=false` مغلقتان قطعيًا، بانتظار اعتماد المراجعة المستقلة (Codex Review).
