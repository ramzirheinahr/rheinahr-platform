const fs = require('fs');
const path = require('path');

function patch(file, funcName, dataType, argName) {
  const fullPath = path.join(__dirname, file);
  if (!fs.existsSync(fullPath)) return;
  let content = fs.readFileSync(fullPath, 'utf8');

  // function FuncDocument({ arg }: { arg: DataType }) {
  const reDocument = new RegExp(`function ${funcName}\\(\\{ ${argName} \\}: \\{ ${argName}: ${dataType} \\}\\) \\{`, 'g');
  content = content.replace(
    reDocument,
    `function ${funcName}({ ${argName}, companyConfig }: { ${argName}: ${dataType}, companyConfig: any }) {`
  );

  // export async function render...(arg: DataType)
  // or export function render...(arg: DataType)
  // return renderToBuffer(<FuncDocument arg={arg} />);
  content = content.replace(
    new RegExp(`export function (.*?)\\(${argName}: ${dataType}\\): Promise<Buffer> \\{`),
    `export async function $1(${argName}: ${dataType}): Promise<Buffer> {`
  );
  
  // Actually, some already became async? Wait, patch-company.js DID match:
  // /export async function (.*?)\((.*?)\)(.*?)\{/g
  // Let's just fix the JSX element:
  const reJSX = new RegExp(`<${funcName} ${argName}=\\{${argName}\\} />`, 'g');
  content = content.replace(
    reJSX,
    `<${funcName} ${argName}={${argName}} companyConfig={companyConfig} />`
  );

  fs.writeFileSync(fullPath, content, 'utf8');
}

patch("lib/pdf/leistungsnachweis.tsx", "LeistungsnachweisDocument", "LeistungsnachweisData\\[\\]", "entries");
patch("lib/pdf/monatsuebersicht.tsx", "MonatsuebersichtDocument", "MonatsuebersichtData", "d");
patch("lib/pdf/order-request.tsx", "OrderRequestDocument", "OrderRequestPdfData", "d");
