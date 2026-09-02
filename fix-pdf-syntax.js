const fs = require('fs');
const path = require('path');

const files = [
  "lib/pdf/arbeitsvertrag.tsx",
  "lib/pdf/arbeitszeitkonto.tsx",
  "lib/pdf/contract.tsx",
  "lib/pdf/dienstplan.tsx",
  "lib/pdf/invoice.tsx",
  "lib/pdf/leistungsnachweis.tsx",
  "lib/pdf/monatsuebersicht.tsx",
  "lib/pdf/order-request.tsx",
  "lib/pdf/payroll.tsx",
  "lib/pdf/personalliste.tsx",
  "lib/pdf/rahmenvertrag.tsx"
];

function fixFile(file) {
  const fullPath = path.join(__dirname, file);
  if (!fs.existsSync(fullPath)) return;
  let content = fs.readFileSync(fullPath, 'utf8');

  // We have something like:
  // const InvoiceTemplate = ({ data }: { data: InvoicePdfData, companyConfig }: any) => (
  // We want to make it:
  // const InvoiceTemplate = ({ data, companyConfig }: any) => (
  
  content = content.replace(
    /\(\{ data \}\s*:\s*\{ data: [A-Za-z0-9_]+,\s*companyConfig \}\s*:\s*any\)/g,
    '({ data, companyConfig }: any)'
  );
  content = content.replace(
    /\(\{ data \}\s*:\s*\{ data: [A-Za-z0-9_]+ \},\s*companyConfig \}\s*:\s*any\)/g,
    '({ data, companyConfig }: any)'
  );
  content = content.replace(
    /\(\{ data \s*:\s*[A-Za-z0-9_]+,\s*companyConfig \}\s*:\s*any\)/g,
    '({ data, companyConfig }: any)'
  );
  
  // also for entries, title
  content = content.replace(
    /\(\{ entries, title \}\s*:\s*\{\s*entries: [A-Za-z0-9_\[\]]+, title: [A-Za-z0-9_]+,\s*companyConfig \}\s*:\s*any\)/g,
    '({ entries, title, companyConfig }: any)'
  );

  fs.writeFileSync(fullPath, content, 'utf8');
}

files.forEach(fixFile);
