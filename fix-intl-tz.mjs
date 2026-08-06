import fs from 'fs';
import path from 'path';

function walk(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    if (fs.statSync(dirPath).isDirectory()) {
      if (!dirPath.includes('node_modules') && !dirPath.includes('.next') && !dirPath.includes('.git')) {
        walk(dirPath, callback);
      }
    } else {
      if (f.endsWith('.ts') || f.endsWith('.tsx')) {
        callback(path.join(dir, f));
      }
    }
  });
}

walk('.', (file) => {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  // Replace timeZone: "UTC" with timeZone: "Europe/Berlin"
  if (content.includes('timeZone: "UTC"')) {
    content = content.replace(/timeZone:\s*["']UTC["']/g, 'timeZone: "Europe/Berlin"');
    changed = true;
  }
  if (content.includes("timeZone: 'UTC'")) {
    content = content.replace(/timeZone:\s*['"]UTC['"]/g, 'timeZone: "Europe/Berlin"');
    changed = true;
  }

  // Also replace anywhere new Intl.DateTimeFormat("de-DE", { ... }) is missing a timeZone.
  // Actually, for missing timezones, it's safer to just inject it if we find Intl.DateTimeFormat
  if (content.includes('new Intl.DateTimeFormat(')) {
    // A simple regex to inject timeZone if not present
    const regex = /new\s+Intl\.DateTimeFormat\([^,]+,\s*\{([^}]+)\}\)/g;
    content = content.replace(regex, (match, p1) => {
      if (!p1.includes('timeZone')) {
        return match.replace(/\{/, '{ timeZone: "Europe/Berlin",');
      }
      return match;
    });
    
    // Some might not have options at all: new Intl.DateTimeFormat(locale)
    const regex2 = /new\s+Intl\.DateTimeFormat\(([^,)]+)\)/g;
    content = content.replace(regex2, (match, p1) => {
       return `new Intl.DateTimeFormat(${p1}, { timeZone: "Europe/Berlin" })`;
    });
    
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, content, 'utf8');
  }
});
console.log("Done");
