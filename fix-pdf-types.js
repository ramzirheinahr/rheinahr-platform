const fs = require('fs');
const path = require('path');

const types = {
  "lib/pdf/arbeitsvertrag.tsx": "ArbeitsvertragData",
  "lib/pdf/arbeitszeitkonto.tsx": "ArbeitszeitkontoPdfData",
  "lib/pdf/contract.tsx": "ContractPdfData",
  "lib/pdf/dienstplan.tsx": "DienstplanPdfData",
  "lib/pdf/invoice.tsx": "InvoicePdfData",
  "lib/pdf/leistungsnachweis.tsx": "LeistungsnachweisPdfData",
  "lib/pdf/monatsuebersicht.tsx": "MonatsuebersichtPdfData",
  "lib/pdf/order-request.tsx": "OrderRequestPdfData",
  "lib/pdf/payroll.tsx": "PayrollPdfData",
  "lib/pdf/personalliste.tsx": "PersonallistePdfData",
  "lib/pdf/rahmenvertrag.tsx": "RahmenvertragData"
};

function fixFile(file, typeName) {
  const fullPath = path.join(__dirname, file);
  if (!fs.existsSync(fullPath)) return;
  let content = fs.readFileSync(fullPath, 'utf8');

  // We want to change:
  // ({ data, companyConfig }: any) 
  // to:
  // ({ data, companyConfig }: { data: TypeName, companyConfig: any })
  
  content = content.replace(
    /\(\{ data, companyConfig \}\s*:\s*any\)/g,
    `({ data, companyConfig }: { data: ${typeName}, companyConfig: any })`
  );

  // For personalliste, maybe it was entries and title? Wait, my fix-pdf-syntax.js did:
  // ({ entries, title, companyConfig }: any)
  if (file === "lib/pdf/personalliste.tsx" || file === "lib/pdf/dienstplan.tsx") {
      content = content.replace(
          /\(\{ entries, title, companyConfig \}\s*:\s*any\)/g,
          `({ entries, title, companyConfig }: { entries: any, title: any, companyConfig: any })`
      );
  }

  fs.writeFileSync(fullPath, content, 'utf8');
}

for (const [file, typeName] of Object.entries(types)) {
  fixFile(file, typeName);
}
