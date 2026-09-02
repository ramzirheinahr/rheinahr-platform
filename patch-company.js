const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// The files we found in the grep search
const files = [
  "app/[locale]/datenschutz/page.tsx",
  "app/[locale]/impressum/page.tsx",
  "app/[locale]/layout.tsx",
  "app/[locale]/page.tsx",
  "app/manifest.ts",
  "components/logo.tsx",
  "lib/email.ts",
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

function processFile(file) {
  const fullPath = path.join(__dirname, file);
  if (!fs.existsSync(fullPath)) return;
  let content = fs.readFileSync(fullPath, 'utf8');

  // Change import
  content = content.replace(
    /import \{ companyConfig \} from "@\/lib\/config\/company";/g,
    `import { getCompanyConfig } from "@/lib/config/company";`
  );

  // If it's a PDF file
  if (file.startsWith('lib/pdf/')) {
    // Add companyConfig prop to the template
    content = content.replace(/= \(\{ data(.*?) \}\) =>/g, '= ({ data$1, companyConfig }: any) =>');
    content = content.replace(/= \(\{ entries, title \}\) =>/g, '= ({ entries, title, companyConfig }: any) =>');
    
    // Inject await getCompanyConfig() into the generate function
    content = content.replace(
      /export async function (.*?)\((.*?)\)(.*?)\{/g,
      `export async function $1($2)$3{\n  const companyConfig = await getCompanyConfig();`
    );
    
    // Pass companyConfig to the template
    content = content.replace(/<([A-Za-z]+Template|LeistungsnachweisDocument|PersonallisteDocument)/g, '<$1 companyConfig={companyConfig}');
  } 
  // If it's email.ts
  else if (file === 'lib/email.ts') {
    content = content.replace(
      /export function getEmailFooterHtml\(\) \{/g,
      `export async function getEmailFooterHtml() {\n  const companyConfig = await getCompanyConfig();`
    );
  }
  // If it's a Server Component page/layout
  else if (file.includes('page.tsx') || file.includes('layout.tsx')) {
    // If it's the root layout.tsx
    if (file.includes('app/[locale]/layout.tsx')) {
      content = content.replace(
        /export async function generateMetadata\(\)(.*?) \{/g,
        `export async function generateMetadata()$1 {\n  const companyConfig = await getCompanyConfig();`
      );
    } 
    // If it's page.tsx (Datenschutz / Impressum)
    else if (!file.includes('app/[locale]/page.tsx')) {
      content = content.replace(
        /export default function (.*?)\(\) \{/g,
        `export default async function $1() {\n  const companyConfig = await getCompanyConfig();`
      );
      content = content.replace(
        /export default async function (.*?)\((.*?)\) \{/g,
        `export default async function $1($2) {\n  const companyConfig = await getCompanyConfig();`
      );
    }
  }
  // If it's manifest.ts
  else if (file === 'app/manifest.ts') {
    content = content.replace(
      /export default function manifest\(\)/g,
      `export default async function manifest()`
    );
    content = content.replace(
      /export default async function manifest\(\)(.*?) \{/g,
      `export default async function manifest()$1 {\n  const companyConfig = await getCompanyConfig();`
    );
  }
  // If it's logo.tsx
  else if (file === 'components/logo.tsx') {
    content = content.replace(
      /export function Logo\(/g,
      `export async function Logo(`
    );
    content = content.replace(
      /export async function Logo\(([\s\S]*?)\) \{/,
      `export async function Logo($1) {\n  const companyConfig = await getCompanyConfig();`
    );
  }

  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`Patched ${file}`);
}

files.forEach(processFile);
