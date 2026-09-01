const fs = require('fs');
const path = require('path');

const pdfDir = path.join(__dirname, 'lib', 'pdf');
const files = fs.readdirSync(pdfDir).filter(f => f.endsWith('.tsx'));

for (const file of files) {
  const filePath = path.join(pdfDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  
  if (file === 'invoice.tsx') continue; // already handled

  let modified = false;

  // Add import if missing
  if (!content.includes('import { companyConfig }')) {
    content = content.replace(
      'import React from "react";',
      'import React from "react";\nimport { companyConfig } from "@/lib/config/company";'
    );
    modified = true;
  }

  // Replace hardcoded strings
  const replacements = [
    { from: />RheinAhr Dienstleistungen GmbH</g, to: '>{companyConfig.name}<' },
    { from: /"RheinAhr Dienstleistungen GmbH"/g, to: 'companyConfig.name' },
    { from: />RheinAhr</g, to: '>{companyConfig.shortName}<' },
    { from: /RheinAhr Dienstleistungen GmbH • Musterstraße 1 • 53474 Bad Neuenahr-Ahrweiler/g, to: '{companyConfig.name} • {companyConfig.street} • {companyConfig.city}' },
    { from: /Signiert von RheinAhr Dienstleistungen GmbH \(Verleiher\),/g, to: 'Signiert von {companyConfig.name} (Verleiher),' }
  ];

  for (const { from, to } of replacements) {
    if (content.match(from)) {
      content = content.replace(from, to);
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${file}`);
  }
}
