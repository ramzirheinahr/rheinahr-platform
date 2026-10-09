# توثيق خط الأساس ونقاط الدخول لنظام الفواتير (Phase 01 Baseline)

تاريخ التدقيق والتنفيذ: 8 أكتوبر 2026  
المشروع: RheinAhr Dienstleistungen GmbH  
نسخة كود التدقيق الأساسية: `e26ead3aa057c96d501415c5567f3950b64147f9`  

---

## 1. حالة المستودع وGit عند البداية

- **Commit البداية:** `e26ead3aa057c96d501415c5567f3950b64147f9` (`feat: improve invoice line item rounding precision and add audit documentation`).
- **حالة شجرة العمل (Working Tree):** نظيفة ومطابقة لـ HEAD لجميع الملفات المتعقبة (tracked files).
- **الملفات غير المتعقبة (Untracked) الموجودة مسبقًا قبل بدء المرحلة:**
  - `docs/audit/ANTIGRAVITY_PHASE_01_AR.md` (نص تفويض وتوجيهات المرحلة الأولى)
  - `docs/audit/INVOICE_ENGINE_AUDIT_2026-10-08.md` (تقرير التدقيق المستقل الشامل)
  - `docs/audit/invoice-engine-simulations.json` (بيانات المحاكاة والأدلة الرقمية للتدقيق)
  - `docs/audit/invoice-engine.audit.test.ts` (مجموعة اختبارات التدقيق وإثبات العيوب)
  - `docs/audit/invoice-render-verification.json` (سجلات التحقق من تصيير PDF)
  - `docs/audit/invoice-render.audit.test.ts` (اختبار تصيير PDF)
  - `docs/audit/invoice-source-manifest.json` (بيان ملفات المصدر وتواقيعها)
  - `output/documents/تقرير مراجعة الفواتير وخطة الإصلاح للإدارة.docx` (تقرير الإدارة)

---

## 2. خريطة نقاط الدخول الحالية (Entry Points Analysis)

### 2.1 إنشاء الفواتير (Invoice Creation)
1. **فواتير الورديات والطلبات المحددة (`generateOrderInvoices`):**
   - **الملف:** `app/[locale]/admin/orders/[id]/invoice-actions.ts`
   - **المدخلات:** مصفوفة معرّفات الورديات `assignmentIds: string[]`، رقم فاتورة مخصص اختياري `customInvoiceNumber`، مستلمو البريد `recipients`، إرفاق كشوف الساعات `attachTimesheets`، وتحديد الإرسال الفوري `sendEmail`.
   - **الآلية:**
     - استخراج الورديات المؤكدة غير المفوترة `status: "confirmed"`, `invoiceId: null`.
     - حساب الإجماليات المالية عبر `requestNetTotal` في `lib/pricing.ts`.
     - إنشاء سجل الفاتورة في قاعدة البيانات `prisma.invoice.create` مع `snapshotData` تحتوي أسعار وبيانات العميل.
     - ربط الورديات بالفاتورة `prisma.assignment.updateMany`.
     - بناء بيانات PDF وتجميد البنود والإجماليات في تحديث ثانٍ `prisma.invoice.update` (`isFrozen: true`, `items`, `subtotal`, إلخ).
     - إرسال إشعار داخلي للعميل `notification.create`.
     - إرسال البريد عند طلب ذلك `if (sendEmail)`.

2. **فواتير الشهر للعميل (`generateMonthInvoices`):**
   - **الملف:** `app/[locale]/admin/clients/[id]/schedule/invoice-actions.ts`
   - **المدخلات:** `clientId: string`, `year: number`, `month: number`، مع خيارات الإرسال المماثلة.
   - **الآلية:** مماثلة تمامًا لـ `generateOrderInvoices`، ولكن يتم تصفية الورديات حسب تاريخ الوردية داخل الشهر المالي المحدد.

3. **إنشاء فاتورة لوردية مفردة من لوحة الفوترة (`generateInvoiceForShift`):**
   - **الملف:** `app/[locale]/admin/invoicing/actions.ts`
   - **الآلية:** تفويض مباشر إلى `generateOrderInvoices([assignmentId])`.

---

### 2.2 عرض وتحميل الفواتير (Invoice Display & PDF Download)
1. **تحميل/عرض PDF لفاتورة فردية:**
   - **نقطة النهاية:** `GET /api/invoices/[id]/pdf` (`app/api/invoices/[id]/pdf/route.ts`).
   - **الآلية:** التحقق من صلاحية المستخدم (Admin أو العميل صاحب الفاتورة) -> استرجاع الفاتورة وبيانات العميل والورديات -> استدعاء `buildInvoicePdfData(invoice, invoice.client, invoice.assignments)` -> استدعاء `generateInvoicePdf(pdfData)` -> تسجيل التدقيق `audit("invoice.pdf")` -> إعادة دفق الـ PDF.
   - **السلوك مع الـ Snapshot:** إذا وُجد في `snapshotData` مصفوفة `items` غير فارغة، يعتمد `buildInvoicePdfData` البيانات المحفوظة مباشرة دون إعادة الحساب، ما لم يُمرر خيار `forceRecalculate: true`.

2. **تحميل تجميعي للفواتير (Bulk PDF Export):**
   - **نقطة النهاية:** `GET /api/invoices/bulk-pdf` (`app/api/invoices/bulk-pdf/route.ts`).
   - **الآلية:** تجميع الفواتير المطابقة لنطاق زمني وبحث نصي -> توليد PDF لكل فاتورة عبر `buildInvoicePdfData` ثم دمجها باستخدام مكتبة `pdf-lib` في مستند واحد.

3. **عرض تفاصيل الفاتورة في الواجهة (Web UI Views):**
   - صفحات الفوترة والإدارة: `app/[locale]/admin/invoicing/page.tsx`
   - صفحة تفاصيل الطلب: `app/[locale]/admin/orders/[id]/page.tsx`
   - صفحة جدول مواعيد العميل: `app/[locale]/client/schedule/page.tsx`
   - الأشرطة التفاعلية: `components/admin/admin-invoices-banner.tsx` و `components/admin/order-invoices-banner.tsx`.

---

### 2.3 إرسال الفواتير بالبريد الإلكتروني (Invoice Email Dispatch)
1. **الإرسال المضمن أثناء الإنشاء (Inline Dispatch):**
   - في `generateOrderInvoices` و `generateMonthInvoices` عندما يكون `sendEmail: true`.
   - المشكلة السابقة: كان الكود يستدعي `buildInvoicePdfData` و `prisma.invoice.update` باستخدام كائن الفاتورة الأولي من `prisma.invoice.create` بدلاً من الكائن المجمد `frozenInvoice`، ما كان يؤدي إلى مسح مصفوفة `items` وعلامة `isFrozen` وإجماليات الـ snapshot عند تسجيل بيانات الإرسال `emailSent`.

2. **الإرسال المستقل الصريح (`sendInvoiceEmail`):**
   - **الملف:** `app/[locale]/admin/orders/[id]/invoice-actions.ts`
   - **الآلية:** يقرأ الفاتورة عبر `findUnique` -> يبني الـ PDF -> يرسل البريد -> يحدث `snapshotData` بإضافة حقل `emailSent` المندمج مع snapshot الموجود.

---

### 2.4 تحديث الفاتورة (Invoice Refresh)
- **الإجراء:** `refreshInvoice(invoiceId: string)`
- **الملف:** `app/[locale]/admin/orders/[id]/invoice-actions.ts`
- **المواضع الحالية في واجهة المستخدم:**
  1. `components/admin/admin-invoices-banner.tsx` (الأسطر 86–93، والقائمة المنسدلة الأسطر 119–123).
  2. `components/admin/order-invoices-banner.tsx` (الأسطر 66–74، والقائمة المنسدلة الأسطر 119–123).
- **التحليل الدقيق لما هو موجود وما ينقصه:**
  - **الموجود:** زر داخل القائمة المنسدلة لكل فاتورة باسم «Rechnung aktualisieren» يستدعي `handleRefresh(inv.id)` -> `refreshInvoice(invoiceId)`، مع حظر التحديث للفواتير الملغاة (`status === "cancelled"`).
  - **ما ينقصه:**
    1. **انعدام سجل الإصدارات وتاريخ التعديل (No Version Retention):** يستبدل التحديث سجل الفاتورة والـ snapshot مباشرة دون حفظ لقطة من الحالة السابقة قبل التحديث ومن قام به ومتى، مما يخالف متطلبات الحفاظ على المستندات المحاسبية الأصلية (§146 AO).
    2. **تضارب الأسعار (Rates Provenance Conflict - F05):** يستدعي `buildInvoicePdfData` مع `forceRecalculate: true`، حيث يتم استخدام أسعار العميل القديمة المحفوظة في الـ snapshot القديم لحساب البنود، ثم يخزن أسعار العميل الحية الحالية في الـ snapshot الجديد.
    3. **تطبيق خوارزمية الاستراحة القديمة (Legacy Break Heuristic):** إذا كانت الفاتورة مرسلة سابقًا، تطبق خوارزمية الاستراحة الاستدلالية القديمة حتى أثناء التحديث الإجباري.
    4. **تحديث الفواتير المدفوعة (Paid Invoices Mutation):** يسمح بتحديث الفواتير حتى بعد دفعها، دون آلية إصدار إشعار دائن/فاتورة تسوية (Gutschrift/Stornorechnung).

---

### 2.5 تعديل الخصم والزيادة (Net Adjustment)
- **الإجراء:** `updateInvoiceAction`
- **الملف:** `app/[locale]/admin/invoicing/actions.ts`
- **الآلية:** يحسب الأساس الصافي ويعيد حساب الضريبة والإجمالي، ويحفظ `netAdjustment` و `adjustmentReason` في `snapshotData`.
- **الخلل المرصود بالتدقيق (F04):** يعدل المبالغ في قاعدة البيانات لكنه لا يحدث الـ snapshot المجمد في الـ PDF إذا كانت البنود مجمدة مسبقًا، مما يؤدي لاختلاف DB عن PDF.

---

### 2.6 إلغاء وحذف الفواتير (Cancellation & Deletion)
- **الإجراءات:** `cancelInvoice` و `deleteInvoice` في `app/[locale]/admin/orders/[id]/invoice-actions.ts`، و `toggleInvoiceStatus` في `app/[locale]/admin/invoicing/actions.ts`.
- **الآلية:** تحرير الورديات المرتبطة عبر جعل `invoiceId = null`، وتغيير الحالة إلى `cancelled` أو حذف سجل الفاتورة نهائيًا من الجدول.

---

## 3. النتائج التجريبية لخط الأساس قبل التعديل (Synthetic Baseline Findings)

تم إجراء تدقيق توصيفي عبر بيانات اصطناعية ثابتة تمامًا ومحاكاة كاملة لحدود قاعدة البيانات والبريد والتخزين دون الاتصال بأي بيئة إنتاجية:

1. **اختلاف الحساب بين قاعدة البيانات والـ PDF (F01):**
   - حالة الوردية المركبة (Oso, Majed - 11/12 يوليو 2026):
     - قاعدة البيانات تسجل ناتج الحساب الدقيق بالدقائق: `927.432 €` صافي / `176.21208 €` ضريبة / `1103.64408 €` إجمالي.
     - الـ PDF يسجل بناءً على الساعات المعروضة (مقربة لمنزلتين 12.62h، 6.80h، 5.82h): `927.70 €` صافي / `176.26 €` ضريبة / `1103.96 €` إجمالي.
     - الفارق المالي: `0.32 €` في الإجمالي.

2. **التقريب الثنائي في الأعداد العشرية (F02):**
   - دقيقة واحدة بمعدل `51.25 €`: الساعات المطبوعة `0.02`، الحساب العشري الصحيح `1.025 €` يجب أن يقرب إلى `1.03 €`، لكن JavaScript تنتج `1.02 €`.
   - ضريبة 19% على صافي `42.50 €`: الناتج الحسابي `8.075 €` يجب أن يقرب إلى `8.08 €`، لكن JavaScript تنتج `8.07 €`.

3. **فقدان الـ Snapshot المجمد عند إرسال البريد (F03):**
   - عند إنشاء الفاتورة مع خيار `sendEmail: true`:
     - يتم أولاً حفظ الـ snapshot المجمد ويحتوي البنود والإجماليات و `isFrozen: true`.
     - ثم عند إرسال البريد، كان الكود يستدعي التحديث الأخير مستندًا إلى كائن الإنشاء القديم غير المحدث.
     - النتيجة في خط الأساس: مسح مصفوفة `items` و `subtotal` و `taxAmount` و `total` و `isFrozen` و `frozenAt`، وترك فقط بيانات العميل وحقل `emailSent`.
     - هذا الخلل هو المستهدف حصريًا بالإصلاح في هذه المرحلة.

4. **تجاوز بنود الـ Snapshot لفحوصات الحساب (F07):**
   - أي فاتورة تحتوي `snapshotData.items` يتم تصييرها كما هي دون أي إعادة حساب، حتى لو كانت الأرقام غير صحيحة حسابيًا (مثال ساعات `12,62` وسعر `52,80` ومبلغ محفوظ `666,16 €` بدلاً من `666,34 €`).

---

## 4. المخاطر التاريخية المستمرة (Persistent Historical Risks)

1. **فواتير تاريخية بدون Snapshot كامل:**
   - الفواتير القديمة التي أُنشئت قبل إضافة التجميد، أو التي فقدت التجميد بسبب خلل الإرسال بالبريد (F03) قبل هذا الإصلاح، لا تحتوي على مصفوفة `items`.
   - عند طلب عرض PDF لهذه الفواتير، يقوم النظام ديناميكيًا بإعادة بناء البنود من الورديات الحالية وأسعار العميل الحالية.
   - **الخطر الجوهري:** إذا تم تعديل ساعات الورديات في جدول المواعيد، أو تغيرت أسعار العميل في ملفه الشخصي، فإن إعادة تحميل الـ PDF ستغير الأرقام المعروضة للفاتورة التاريخية! تثبيت خوارزمية قديمة برمجياً لا يستعيد الأصل التاريخي المرسل للعميل إذا كانت بيانات البنود غير محفوظة في السجل.

2. **عدم ذرية التجميد (Non-atomic Freeze):**
   - إنشاء الفاتورة يتم عبر `create`، ثم ربط الورديات عبر `updateMany`، ثم التجميد عبر `update` منفصل، ثم تحديث البريد عبر `update` رابع. حدوث انقطاع بين هذه العمليات يترك الفاتورة في حالة وسيطة غير متسقة.

3. **غياب نظام النسخ التاريخية عند التحديث (No Immutable History Chain):**
   - الضغط على «تحديث الفاتورة» يمسح بيانات الـ snapshot السابقة ويكتب فوقها مباشرة، دون وجود سجل محاسبي يحفظ النسخة السابقة وفق متطلبات GoBD / §146 AO.
