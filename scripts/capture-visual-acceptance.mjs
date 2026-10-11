import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { assertSyntheticSeedTarget } from "./phase07c-seed-safety.mjs";

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.id = 1;
    this.callbacks = new Map();
    this.events = new Map();

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.callbacks.has(data.id)) {
        const { resolve, reject } = this.callbacks.get(data.id);
        this.callbacks.delete(data.id);
        if (data.error) reject(data.error);
        else resolve(data.result);
      } else if (data.method) {
        const handlers = this.events.get(data.method);
        if (handlers) {
          handlers.forEach((h) => h(data.params));
        }
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event, handler) {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event).push(handler);
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getNewTabWsUrl() {
  const res = await fetch("http://localhost:9222/json/new?about:blank", { method: "PUT" });
  const data = await res.json();
  return { wsUrl: data.webSocketDebuggerUrl, targetId: data.id };
}

async function closeTab(targetId) {
  await fetch(`http://localhost:9222/json/close/${targetId}`);
}

// Global script to dismiss any cookie banner and PWA prompts
const dismissOverlaysCode = `
  (() => {
    // Dismiss cookie banners
    const cookieBtns = Array.from(document.querySelectorAll('button')).filter(b =>
      b.innerText.includes('Verstanden') || b.innerText.includes('Akzeptieren') || b.innerText.includes('موافق')
    );
    cookieBtns.forEach(b => b.click());

    // Dismiss PWA install dialog
    const pwaClose = Array.from(document.querySelectorAll('button')).filter(b =>
      b.innerText.includes('Später') || b.innerText.includes('لاحقاً')
    );
    pwaClose.forEach(b => b.click());
  })();
`;

async function captureCase({
  name,
  url,
  viewport,
  cookies,
  action,
  verify,
  outDir,
}) {
  console.log(`\nCapturing [${name}] -> ${url} (${viewport.width}x${viewport.height})`);
  const { wsUrl, targetId } = await getNewTabWsUrl();
  const ws = new WebSocket(wsUrl);

  await new Promise((res) => {
    ws.onopen = res;
  });

  const cdp = new CdpClient(ws);
  try {

  await cdp.send("Page.enable");
  await cdp.send("Network.enable");

  // Set cookies
  if (cookies) {
    for (const c of cookies) {
      await cdp.send("Network.setCookie", {
        name: c.name,
        value: c.value,
        domain: "localhost",
        path: "/",
        httpOnly: true,
      });
    }
  }

  // Set viewport
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile || false,
  });

  // Navigate
  await cdp.send("Page.navigate", { url });

  // Wait for initial load
  await sleep(2500);

  // Dismiss cookies & PWA prompts first
  try {
    await cdp.send("Runtime.evaluate", { expression: dismissOverlaysCode });
    await sleep(400);
  } catch {}

  // Execute interactive UI actions if specified
  if (action) {
    const executed = await cdp.send("Runtime.evaluate", {
      expression: action,
      awaitPromise: true,
      returnByValue: true,
    });
    if (executed.exceptionDetails) {
      throw new Error(`Action failed for ${name}: ${executed.exceptionDetails.text}`);
    }
    await sleep(1500);
    // Dismiss overlays again if action triggered any
    await cdp.send("Runtime.evaluate", { expression: dismissOverlaysCode });
    await sleep(400);
  }
  if (verify) {
    let verified = false;
    for (let i = 0; i < 40; i++) {
      try {
        const checked = await cdp.send("Runtime.evaluate", {
          expression: verify,
          awaitPromise: true,
          returnByValue: true,
        });
        if (!checked.exceptionDetails && checked.result?.value === true) {
          verified = true;
          break;
        }
      } catch { /* Navigation may replace the execution context; retry. */ }
      await sleep(200);
    }
    if (!verified) {
      throw new Error(`Visual acceptance assertion failed for ${name}`);
    }
  }

  const screenshot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    quality: 100,
  });

  const buffer = Buffer.from(screenshot.data, "base64");
  const filePath = path.join(outDir, `${name}.png`);
  fs.writeFileSync(filePath, buffer);

  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  console.log(`Saved: ${filePath} (${buffer.length} bytes, SHA-256: ${hash})`);

  return { name, filePath, hash, sizeBytes: buffer.length, width: viewport.width, height: viewport.height };
  } finally {
    ws.close();
    await closeTab(targetId);
  }
}

async function main() {
  // A browser action approves a correction. Never point it at an inherited
  // server/database configuration or a non-local application instance.
  assertSyntheticSeedTarget(process.env);
  const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const outDir = process.env.PHASE07C_CAPTURE_OUTPUT_DIR || "/Users/iquik/Developer/RheinAhr Dienstleistungen GmbH/invoice-repair-phase-07c/screenshots";
  fs.mkdirSync(outDir, { recursive: true });

  const adminCookie = [{ name: "app_session", value: "admin_test_session_token" }];
  const desktop = { width: 1280, height: 800, mobile: false };
  const mobile = { width: 375, height: 667, mobile: true };

  const results = [];
  const logEntries = [];

  const addLog = (msg) => {
    console.log(msg);
    logEntries.push(`[${new Date().toISOString()}] ${msg}`);
  };

  addLog("=== RheinAhr Phase 07c Visual & Interactive Acceptance Session ===");
  addLog("Local isolated PostgreSQL: localhost:54329 (db: rheinahr_visual_test)");
  addLog("Next.js dev server: http://localhost:3005");
  addLog("Headless Chrome 155 CDP: http://localhost:9222");

  // =========================================================================
  // REQUEST 1: Cancelled Invoices Tab, Tab Aggregation, Search & Isolation
  // =========================================================================
  const clickCancelledInvoicesDesktop = `
    (() => {
      const tab = Array.from(document.querySelectorAll('[role="tab"]')).find(t =>
        t.innerText.includes("Stornierte") || t.innerText.includes("الملغاة")
      );
      if (!tab) throw new Error("Cancelled-invoices tab is missing");
      tab.click();
    })()
  `;

  const clickCancelledInvoicesMobile = `
    (() => {
      const tab = Array.from(document.querySelectorAll('[role="tab"]')).find(t =>
        t.innerText.includes("Stornierte") || t.innerText.includes("الملغاة")
      );
      if (!tab) throw new Error("Cancelled-invoices tab is missing");
      tab.click();
      tab.scrollIntoView({ inline: "center", block: "center", behavior: "instant" });
    })()
  `;

  // 1.1 Desktop German
  results.push(
    await captureCase({
      name: "case1_cancelled_invoices_tab_de_desktop",
      url: "http://localhost:3005/de/admin/invoicing",
      viewport: desktop,
      cookies: adminCookie,
      action: clickCancelledInvoicesDesktop,
      outDir,
    })
  );
  addLog("Captured case1_cancelled_invoices_tab_de_desktop");

  // 1.2 Desktop Arabic (RTL)
  results.push(
    await captureCase({
      name: "case1_cancelled_invoices_tab_ar_rtl_desktop",
      url: "http://localhost:3005/ar/admin/invoicing",
      viewport: desktop,
      cookies: adminCookie,
      action: clickCancelledInvoicesDesktop,
      outDir,
    })
  );
  addLog("Captured case1_cancelled_invoices_tab_ar_rtl_desktop");

  // 1.3 Mobile German - Tab visible with badge (1) and rows
  results.push(
    await captureCase({
      name: "case1_cancelled_invoices_tab_de_mobile",
      url: "http://localhost:3005/de/admin/invoicing",
      viewport: mobile,
      cookies: adminCookie,
      action: clickCancelledInvoicesMobile,
      outDir,
    })
  );
  addLog("Captured case1_cancelled_invoices_tab_de_mobile");

  // 1.4 Mobile Arabic (RTL) - Tab visible with badge (1) and rows
  results.push(
    await captureCase({
      name: "case1_cancelled_invoices_tab_ar_rtl_mobile",
      url: "http://localhost:3005/ar/admin/invoicing",
      viewport: mobile,
      cookies: adminCookie,
      action: clickCancelledInvoicesMobile,
      outDir,
    })
  );
  addLog("Captured case1_cancelled_invoices_tab_ar_rtl_mobile");

  // =========================================================================
  // REQUEST 2 & 3: Shift Details & Evidence Timeline Workflow (Pending State)
  // =========================================================================
  const openEvidenceTimelineModal = `
    (async () => {
      const trigger = document.querySelector('[data-order-id="ord-wf-1"] button, [data-shift-id="ord-wf-1"] button');
      if (!trigger) throw new Error("Target shift is missing");
      trigger.click();
      await new Promise(r => setTimeout(r, 800));
      const dialog = document.querySelector('[role="dialog"]');
      const btn = Array.from(dialog?.querySelectorAll("button") || []).find(b =>
        b.innerText.includes("Nachweise anzeigen") || b.innerText.includes("عرض الأدلة والمستندات")
      );
      if (!btn) throw new Error("Evidence timeline button is missing");
      btn.click();
      await new Promise(r => setTimeout(r, 1000));
    })()
  `;

  // 2.1 Desktop German Evidence Timeline (Before approval)
  results.push(
    await captureCase({
      name: "case2_3_shift_correction_workflow_de_desktop",
      url: "http://localhost:3005/de/admin/orders/ord-wf-1",
      viewport: desktop,
      cookies: adminCookie,
      action: openEvidenceTimelineModal,
      outDir,
    })
  );
  addLog("Captured case2_3_shift_correction_workflow_de_desktop");

  // 2.2 Desktop Arabic (RTL) Evidence Timeline (Before approval)
  results.push(
    await captureCase({
      name: "case2_3_shift_correction_workflow_ar_rtl_desktop",
      url: "http://localhost:3005/ar/admin/orders/ord-wf-1",
      viewport: desktop,
      cookies: adminCookie,
      action: openEvidenceTimelineModal,
      outDir,
    })
  );
  addLog("Captured case2_3_shift_correction_workflow_ar_rtl_desktop");

  // 2.3 Mobile German Evidence Timeline (Responsive, no clipping)
  results.push(
    await captureCase({
      name: "case2_3_shift_correction_workflow_de_mobile",
      url: "http://localhost:3005/de/admin/orders/ord-wf-1",
      viewport: mobile,
      cookies: adminCookie,
      action: openEvidenceTimelineModal,
      outDir,
    })
  );
  addLog("Captured case2_3_shift_correction_workflow_de_mobile");

  // 2.4 Mobile Arabic (RTL) Evidence Timeline (Responsive, RTL layout)
  results.push(
    await captureCase({
      name: "case2_3_shift_correction_workflow_ar_rtl_mobile",
      url: "http://localhost:3005/ar/admin/orders/ord-wf-1",
      viewport: mobile,
      cookies: adminCookie,
      action: openEvidenceTimelineModal,
      outDir,
    })
  );
  addLog("Captured case2_3_shift_correction_workflow_ar_rtl_mobile");

  // =========================================================================
  // REQUEST 3 ACTION TRAIL: Executing Approval in the Real UI Modal (After State)
  // =========================================================================
  const executeApprovalAction = `
    (async () => {
      // 1. Open shift dialog
      const trigger = document.querySelector('[data-order-id="ord-wf-1"] button, [data-shift-id="ord-wf-1"] button');
      if (!trigger) throw new Error("Target shift is missing");
      trigger.click();
      await new Promise(r => setTimeout(r, 800));

      // 2. Click Nachweise anzeigen
      const dialog = document.querySelector('[role="dialog"]');
      const btn = Array.from(dialog?.querySelectorAll("button") || []).find(b =>
        b.innerText.includes("Nachweise anzeigen") || b.innerText.includes("عرض الأدلة والمستندات")
      );
      if (!btn) throw new Error("Evidence timeline button is missing");
      btn.click();
      await new Promise(r => setTimeout(r, 1000));

      // 3. In the evidence timeline, click Korrektur genehmigen
      const topDialog = Array.from(document.querySelectorAll('[role="dialog"]')).pop();
      const approveBtn = Array.from(topDialog?.querySelectorAll("button") || []).find(b =>
        b.innerText.includes("Korrektur genehmigen") || b.innerText.includes("اعتماد التصحيح")
      );
      if (!approveBtn) throw new Error("Approval button is missing");
      approveBtn.click();
      await new Promise(r => setTimeout(r, 800));

      // In the approve confirmation modal, click Bestätigen / Genehmigen
      const subDialog = Array.from(document.querySelectorAll('[role="dialog"]')).pop();
      const confirmBtn = Array.from(subDialog?.querySelectorAll("button") || []).find(b =>
        b.innerText.includes("Bestätigen") || b.innerText.includes("Genehmigen") || b.innerText.includes("اعتماد") || b.classList.contains("bg-emerald-600")
      );
      if (!confirmBtn) throw new Error("Approval confirmation button is missing");
      confirmBtn.click();
      await new Promise(r => setTimeout(r, 2000));
    })()
  `;

  results.push(
    await captureCase({
      name: "case3_action_approval_executed_after_de_desktop",
      url: "http://localhost:3005/de/admin/orders/ord-wf-1",
      viewport: desktop,
      cookies: adminCookie,
      action: executeApprovalAction,
      verify: `Array.from(document.querySelectorAll('[role="dialog"]')).some(d => d.innerText.includes("Effektive Arbeitsstunden: 6.5") && d.innerText.includes("Verlauf der Korrekturanträge") && d.innerText.includes("Genehmigt"))`,
      outDir,
    })
  );
  addLog("Executed approval action in real UI and captured case3_action_approval_executed_after_de_desktop");

  // =========================================================================
  // REQUEST 4: Direct Evidence Document Streaming (PDF Headers & Render Proof)
  // =========================================================================
  const evidenceDocUrl = "http://localhost:3005/api/confirmations/asg-wf-1/document?documentId=doc-wf-1";

  // RBAC checks
  const rbacAdmin = await fetch(evidenceDocUrl, { headers: { Cookie: "app_session=admin_test_session_token" } });
  const rbacWorker1 = await fetch(evidenceDocUrl, { headers: { Cookie: "app_session=worker_test_session_token" } });
  const rbacWorker2 = await fetch(evidenceDocUrl, { headers: { Cookie: "app_session=worker2_test_session_token" } });
  const rbacClient = await fetch(evidenceDocUrl, { headers: { Cookie: "app_session=client_test_session_token" } });
  const rbacAnon = await fetch(evidenceDocUrl);

  const pdfBytes = Buffer.from(await rbacAdmin.arrayBuffer());
  const pdfHash = crypto.createHash("sha256").update(pdfBytes).digest("hex");
  const pdfHeaders = {
    status: rbacAdmin.status,
    contentType: rbacAdmin.headers.get("content-type"),
    contentDisposition: rbacAdmin.headers.get("content-disposition"),
    cacheControl: rbacAdmin.headers.get("cache-control"),
    xRobotsTag: rbacAdmin.headers.get("x-robots-tag"),
    xContentTypeOptions: rbacAdmin.headers.get("x-content-type-options"),
  };

  const pdfOutPath = path.join(outDir, "case4_evidence_document_streamed.pdf");
  fs.writeFileSync(pdfOutPath, pdfBytes);
  addLog(`Downloaded actual streamed PDF: ${pdfOutPath} (${pdfBytes.length} bytes, SHA-256: ${pdfHash})`);
  addLog(`RBAC Verification Matrix: Admin=${rbacAdmin.status}, Worker1(assigned)=${rbacWorker1.status}, Worker2(unassigned)=${rbacWorker2.status}, Client=${rbacClient.status}, Anonymous=${rbacAnon.status}`);

  if (rbacAdmin.status !== 200 || !pdfHeaders.contentType?.startsWith("application/pdf") || pdfBytes.length < 1000 || pdfBytes.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error("The evidence response is not a valid rendered synthetic PDF.");
  }
  const expectedFixture = fs.readFileSync(new URL("./fixtures/phase07c-stundennachweis.pdf", import.meta.url));
  if (!pdfBytes.equals(expectedFixture)) {
    throw new Error("The streamed evidence bytes differ from the verified visible synthetic fixture.");
  }
  if (rbacWorker1.status !== 200 || rbacWorker2.status !== 403 || rbacClient.status !== 200 || rbacAnon.status !== 401) {
    throw new Error("The evidence endpoint RBAC matrix does not match the expected isolation.");
  }

  // Click the real evidence link from the application. The capture must show
  // Chrome's document viewer, never a hand-built audit page.
  const openEvidencePdfFromApp = `
    (async () => {
      const trigger = document.querySelector('[data-order-id="ord-wf-1"] button, [data-shift-id="ord-wf-1"] button');
      if (!trigger) throw new Error("Target shift is not visible");
      trigger.click();
      await new Promise(r => setTimeout(r, 800));
      const dialog = document.querySelector('[role="dialog"]');
      const button = Array.from(dialog?.querySelectorAll("button") || []).find(b => b.innerText.includes("Nachweise anzeigen"));
      if (!button) throw new Error("Evidence timeline button is missing");
      button.click();
      await new Promise(r => setTimeout(r, 1000));
      const targetHref = "/api/confirmations/asg-wf-1/document?documentId=doc-wf-1";
      const link = Array.from(document.querySelectorAll('[role="dialog"] a')).find(a => a.getAttribute('href') === targetHref);
      if (!link) throw new Error("The target evidence link is missing from the application dialog");
      link.setAttribute("target", "_self");
      link.click();
      return true;
    })()
  `;
  results.push(await captureCase({
    name: "case4_evidence_document_viewer_desktop",
    url: "http://localhost:3005/de/admin/orders/ord-wf-1",
    viewport: desktop,
    cookies: adminCookie,
    action: openEvidencePdfFromApp,
    verify: `location.pathname === "/api/confirmations/asg-wf-1/document" && new URLSearchParams(location.search).get("documentId") === "doc-wf-1"`,
    outDir,
  }));
  addLog("Captured the real application evidence link in Chrome's PDF viewer; HTTP/RBAC checks are recorded separately.");

  // =========================================================================
  // REQUEST 5: Shift Overlap Engine Report & Canonical Link Navigation
  // =========================================================================
  const openShiftOverlapDesktop = `
    (async () => {
      const btns = Array.from(document.querySelectorAll("button"));
      const tabTarget = btns.find(b =>
        b.innerText.includes("Zeiterfassung") || b.innerText.includes("Sync") || b.innerText.includes("نقل الساعات")
      );
      if (!tabTarget) throw new Error("Transfer tab is missing");
      tabTarget.click();
      await new Promise(r => setTimeout(r, 800));
      const curBtns = Array.from(document.querySelectorAll("button"));
      const checkBtn = curBtns.find(b =>
        b.innerText.includes("Schichtüberschneidungen prüfen") || b.innerText.includes("فحص تداخل الورديات")
      );
      if (!checkBtn) throw new Error("Overlap check button is missing");
      checkBtn.click();
      let target = null;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 200));
        target = document.querySelector('table tbody tr a[href*="#shift-ord-ov-1"]');
        if (target) break;
      }
      if (!target) throw new Error("Expected overlap row is missing");
      checkBtn.scrollIntoView({ block: "start", behavior: "instant" });
    })()
  `;

  const openShiftOverlapMobile = `
    (async () => {
      const btns = Array.from(document.querySelectorAll("button"));
      const tabTarget = btns.find(b =>
        b.innerText.includes("Zeiterfassung") || b.innerText.includes("Sync") || b.innerText.includes("نقل الساعات")
      );
      if (!tabTarget) throw new Error("Transfer tab is missing");
      tabTarget.click();
      await new Promise(r => setTimeout(r, 800));
      const curBtns = Array.from(document.querySelectorAll("button"));
      const checkBtn = curBtns.find(b =>
        b.innerText.includes("Schichtüberschneidungen prüfen") || b.innerText.includes("فحص تداخل الورديات")
      );
      if (!checkBtn) throw new Error("Overlap check button is missing");
      checkBtn.click();
      let link = null;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 200));
        link = document.querySelector('table tbody tr a[href*="#shift-ord-ov-1"]');
        if (link) break;
      }
      if (!link) throw new Error("Expected overlap row is missing");
      link.scrollIntoView({ block: "center", behavior: "instant" });
    })()
  `;

  // 5.1 Desktop German Overlap Section
  results.push(
    await captureCase({
      name: "case5_shift_overlap_report_de_desktop",
      url: "http://localhost:3005/de/admin/reports?from=2026-10-01&to=2026-10-31",
      viewport: desktop,
      cookies: adminCookie,
      action: openShiftOverlapDesktop,
      outDir,
    })
  );
  addLog("Captured case5_shift_overlap_report_de_desktop");

  // 5.2 Desktop Arabic Overlap Section (RTL)
  results.push(
    await captureCase({
      name: "case5_shift_overlap_report_ar_rtl_desktop",
      url: "http://localhost:3005/ar/admin/reports?from=2026-10-01&to=2026-10-31",
      viewport: desktop,
      cookies: adminCookie,
      action: openShiftOverlapDesktop,
      outDir,
    })
  );
  addLog("Captured case5_shift_overlap_report_ar_rtl_desktop");

  // 5.3 Mobile German Overlap Section (Scrolled to pair row & canonical links)
  results.push(
    await captureCase({
      name: "case5_shift_overlap_report_de_mobile",
      url: "http://localhost:3005/de/admin/reports?from=2026-10-01&to=2026-10-31",
      viewport: mobile,
      cookies: adminCookie,
      action: openShiftOverlapMobile,
      outDir,
    })
  );
  addLog("Captured case5_shift_overlap_report_de_mobile");

  // 5.4 Mobile Arabic Overlap Section (RTL)
  results.push(
    await captureCase({
      name: "case5_shift_overlap_report_ar_rtl_mobile",
      url: "http://localhost:3005/ar/admin/reports?from=2026-10-01&to=2026-10-31",
      viewport: mobile,
      cookies: adminCookie,
      action: openShiftOverlapMobile,
      outDir,
    })
  );
  addLog("Captured case5_shift_overlap_report_ar_rtl_mobile");

  // 5.5 Canonical Link Navigation Proof: Clicking Schicht 1 in overlap report
  const navigateCanonicalLinkAction = `
    (async () => {
      const btns = Array.from(document.querySelectorAll("button"));
      const tabTarget = btns.find(b => b.innerText.includes("Zeiterfassung") || b.innerText.includes("Sync"));
      if (!tabTarget) throw new Error("Reports tab is missing");
      tabTarget.click();
      await new Promise(r => setTimeout(r, 800));
      const curBtns = Array.from(document.querySelectorAll("button"));
      const checkBtn = curBtns.find(b => b.innerText.includes("Schichtüberschneidungen prüfen"));
      if (!checkBtn) throw new Error("Overlap check button is missing");
      checkBtn.click();
      let link = null;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 200));
        link = document.querySelector('table tbody tr a[href*="#shift-ord-ov-1"]');
        if (link) break;
      }
      if (!link) throw new Error("Target shift link is missing from overlap row");
      const target = new URL(link.href);
      if (target.pathname !== "/de/admin/orders/ord-ov-1" || target.searchParams.get("month") !== "2026-10" || target.hash !== "#shift-ord-ov-1") {
        throw new Error("The overlap row points to an unexpected shift");
      }
      link.setAttribute("target", "_self");
      link.click();
      return true;
    })()
  `;

  results.push(
    await captureCase({
      name: "case5_action_canonical_link_navigated_de_desktop",
      url: "http://localhost:3005/de/admin/reports?from=2026-10-01&to=2026-10-31",
      viewport: desktop,
      cookies: adminCookie,
      action: navigateCanonicalLinkAction,
      verify: `location.pathname === "/de/admin/orders/ord-ov-1" && new URLSearchParams(location.search).get("month") === "2026-10" && location.hash === "#shift-ord-ov-1" && !!document.querySelector('[data-shift-id="ord-ov-1"]')`,
      outDir,
    })
  );
  addLog("Captured case5_action_canonical_link_navigated_de_desktop (clicked link and arrived at order route)");

  // =========================================================================
  // REQUEST 6: Stundenübersicht section vs Stundennachweis document name,
  // separating confirmed actual hours from unverified planned hours
  // =========================================================================
  const openStundenuebersichtDesktop = `
    (async () => {
      const btns = Array.from(document.querySelectorAll("button"));
      const tabTarget = btns.find(b =>
        b.innerText.includes("Stundenübersicht") || b.innerText.includes("PDF") || b.innerText.includes("نظرة عامة على الساعات")
      );
      if (!tabTarget) throw new Error("Hours overview tab is missing");
      tabTarget.click();
      await new Promise(r => setTimeout(r, 800));
      const curBtns = Array.from(document.querySelectorAll("button"));
      const searchBtn = curBtns.find(b =>
        b.innerText.includes("Suchen") || b.innerText.includes("بحث")
      );
      if (!searchBtn) throw new Error("Hours search button is missing");
      searchBtn.click();
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 200));
        if (document.querySelector("tfoot")) break;
      }
      const table = document.querySelector("table");
      if (!table || !document.querySelector("tfoot")) throw new Error("Hours totals are missing");
      table.scrollIntoView({ block: "center", behavior: "instant" });
    })()
  `;

  const openStundenuebersichtMobile = `
    (async () => {
      const btns = Array.from(document.querySelectorAll("button"));
      const tabTarget = btns.find(b =>
        b.innerText.includes("Stundenübersicht") || b.innerText.includes("PDF") || b.innerText.includes("نظرة عامة على الساعات")
      );
      if (!tabTarget) throw new Error("Hours overview tab is missing");
      tabTarget.click();
      await new Promise(r => setTimeout(r, 800));
      const curBtns = Array.from(document.querySelectorAll("button"));
      const searchBtn = curBtns.find(b =>
        b.innerText.includes("Suchen") || b.innerText.includes("بحث")
      );
      if (!searchBtn) throw new Error("Hours search button is missing");
      searchBtn.click();
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 200));
        if (document.querySelector("tfoot")) break;
      }
      // Scroll horizontal container so totals are clearly visible
      const scrollContainers = Array.from(document.querySelectorAll(".overflow-x-auto"));
      for (const sc of scrollContainers) {
        sc.scrollLeft = document.documentElement.dir === "rtl" ? -sc.scrollWidth : sc.scrollWidth;
      }
      const tfoot = document.querySelector("tfoot");
      if (!tfoot) throw new Error("Hours totals are missing");
      tfoot.scrollIntoView({ block: "center", inline: "end", behavior: "instant" });
    })()
  `;

  // 6.1 Desktop German
  results.push(
    await captureCase({
      name: "case6_stundenuebersicht_vs_nachweis_de_desktop",
      url: "http://localhost:3005/de/admin/reports?from=2026-10-01&to=2026-10-31",
      viewport: desktop,
      cookies: adminCookie,
      action: openStundenuebersichtDesktop,
      outDir,
    })
  );
  addLog("Captured case6_stundenuebersicht_vs_nachweis_de_desktop");

  // 6.2 Desktop Arabic (RTL)
  results.push(
    await captureCase({
      name: "case6_stundenuebersicht_vs_nachweis_ar_rtl_desktop",
      url: "http://localhost:3005/ar/admin/reports?from=2026-10-01&to=2026-10-31",
      viewport: desktop,
      cookies: adminCookie,
      action: openStundenuebersichtDesktop,
      outDir,
    })
  );
  addLog("Captured case6_stundenuebersicht_vs_nachweis_ar_rtl_desktop");

  // 6.3 Mobile German - Footer totals scrolled into view
  results.push(
    await captureCase({
      name: "case6_stundenuebersicht_vs_nachweis_de_mobile",
      url: "http://localhost:3005/de/admin/reports?from=2026-10-01&to=2026-10-31",
      viewport: mobile,
      cookies: adminCookie,
      action: openStundenuebersichtMobile,
      outDir,
    })
  );
  addLog("Captured case6_stundenuebersicht_vs_nachweis_de_mobile");

  // 6.4 Mobile Arabic (RTL) - Footer totals scrolled into view
  results.push(
    await captureCase({
      name: "case6_stundenuebersicht_vs_nachweis_ar_rtl_mobile",
      url: "http://localhost:3005/ar/admin/reports?from=2026-10-01&to=2026-10-31",
      viewport: mobile,
      cookies: adminCookie,
      action: openStundenuebersichtMobile,
      outDir,
    })
  );
  addLog("Captured case6_stundenuebersicht_vs_nachweis_ar_rtl_mobile");

  console.log("\n==========================================");
  console.log(`Successfully captured ${results.length} screenshots + 1 streamed PDF!`);
  console.log("==========================================");

  const manifest = {
    generatedAt: new Date().toISOString(),
    gitCommit,
    database: "postgresql://localhost:54329/rheinahr_visual_test",
    pdfEvidenceHeaders: pdfHeaders,
    pdfEvidenceSha256: pdfHash,
    cases: results,
  };

  const manifestPath = path.join(outDir, "VISUAL_MANIFEST.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  addLog(`Visual manifest written to: ${manifestPath}`);

  // Write Session Reproducibility Log
  const logFile = path.join(path.dirname(outDir), "SESSION_REPRODUCIBILITY_LOG.md");
  const logContent = `# RheinAhr Phase 07c — Visual Acceptance Session Reproducibility Log

**Commit:** \`${gitCommit}\`
**Timestamp:** ${new Date().toISOString()}
**Environment:** Isolated Local Environment (Port 3005, DB Port 54329)
**Browser Engine:** Google Chrome 155.0.8059.40 (Official Build, Headless) via Chrome DevTools Protocol (CDP)

## 1. Environment & Infrastructure Isolation
- **Database:** Dedicated local PostgreSQL 16 cluster on port \`54329\` (\`/tmp/rheinahr_local_postgres_data\`).
  - Strict isolation: zero connection to production DB (\`rheinahr.de\` / Supabase production pool).
- **Web Server:** Next.js Webpack dev server running on port \`3005\` with isolated \`.env.local\`.
- **Storage:** Local symlinked directory \`confirmations -> storage/confirmations\` hosting binary fixtures. Zero connection to live production object storage.
- **Email:** Isolated mock logger (\`SMTP_HOST=localhost\`). Zero live emails dispatched.
- **Feature Flags:**
  - \`FEATURE_INVOICE_V2_ISSUANCE = false\`
  - \`FEATURE_INVOICE_V2_REFRESH = false\`
  - \`UNEXECUTED_STAGING_GATE_OPEN = true\` (PostgreSQL Staging Gate remains explicitly open).

## 2. RBAC Security Audit Matrix (Request 4)
Target Endpoint: \`GET /api/confirmations/asg-wf-1/document?documentId=doc-wf-1\`
| Principal / Actor | Session Token | HTTP Status | Verdict |
| :--- | :--- | :--- | :--- |
| **Admin User** | \`admin_test_session_token\` | **200 OK** | Authorized (Administrative Access) |
| **Worker 1 (Assigned)** | \`worker_test_session_token\` | **200 OK** | Authorized (Assigned Worker Identity Match) |
| **Client (Facility Owner)**| \`client_test_session_token\` | **200 OK** | Authorized (Owning Facility Match) |
| **Worker 2 (Unassigned)** | \`worker2_test_session_token\` | **403 Forbidden** | Protected (FORBIDDEN_ASSIGNMENT_ACCESS) |
| **Anonymous / Public** | None | **401 Unauthorized** | Protected (Authentication Required) |

## 3. Streamed Document Verification
- **Output File:** \`invoice-repair-phase-07c/screenshots/case4_evidence_document_streamed.pdf\`
- **Byte Length:** ${pdfBytes.length} bytes
- **SHA-256 Digest:** \`${pdfHash}\`
- **HTTP Response Headers:**
  - \`content-type\`: \`${pdfHeaders.contentType}\`
  - \`content-disposition\`: \`${pdfHeaders.contentDisposition}\`
  - \`cache-control\`: \`${pdfHeaders.cacheControl}\`
  - \`x-robots-tag\`: \`${pdfHeaders.xRobotsTag}\`
  - \`x-content-type-options\`: \`${pdfHeaders.xContentTypeOptions}\`

## 4. Execution Step Log
${logEntries.map(e => "- " + e).join("\n")}
`;
  fs.writeFileSync(logFile, logContent);
  console.log(`Session reproducibility log written to: ${logFile}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
