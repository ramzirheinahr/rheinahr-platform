import fs from 'fs';

const files = [
  "lib/invoice-pdf-builder.ts",
  "components/client/contract-sign-dialog.tsx",
  "components/admin/appointment-dialog.tsx",
  "components/admin/contract-admin-dialog.tsx",
  "components/admin/arbeitsvertrag-section.tsx",
  "components/admin/invoicing-list.tsx",
  "components/admin/client-contracts-banner.tsx",
  "components/admin/rahmenvertrag-section.tsx",
  "lib/payroll-pdf-builder.ts",
  "lib/pdf/rahmenvertrag.tsx",
  "lib/pdf/arbeitsvertrag.tsx",
  "app/api/contracts/[contractId]/pdf/route.ts",
  "app/[locale]/public/contract/[id]/actions.ts"
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/import\s+\{\s*format\s*\}\s*from\s+["']date-fns["'];?/g, 'import { format } from "@/lib/date-utils";');
  fs.writeFileSync(file, content, 'utf8');
}

// Special case for components/admin/appointments-calendar.tsx
const calFile = "components/admin/appointments-calendar.tsx";
let calContent = fs.readFileSync(calFile, 'utf8');
calContent = calContent.replace(
  'import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek } from "date-fns";',
  'import { startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek } from "date-fns";\nimport { format } from "@/lib/date-utils";'
);
fs.writeFileSync(calFile, calContent, 'utf8');
console.log("Done");
