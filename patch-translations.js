const fs = require('fs');
const path = require('path');

const messagesDir = path.join(__dirname, 'messages');
const files = ['ar.json', 'de.json', 'en.json'];

files.forEach(file => {
  const filePath = path.join(messagesDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Generic replacements
  if (file === 'de.json') {
    content = content.replace(/RheinAhr Dienstleistungen/g, 'unserer Agentur');
    content = content.replace(/RheinAhr-Team/g, 'unserem Team');
    content = content.replace(/RheinAhr/g, 'uns');
  } else if (file === 'en.json') {
    content = content.replace(/RheinAhr Dienstleistungen/g, 'our agency');
    content = content.replace(/RheinAhr team/g, 'our team');
    content = content.replace(/RheinAhr/g, 'us');
  } else if (file === 'ar.json') {
    content = content.replace(/فريق RheinAhr/g, 'فريقنا');
    content = content.replace(/مع RheinAhr/g, 'معنا');
    content = content.replace(/لدى RheinAhr/g, 'لدينا');
    content = content.replace(/RheinAhr/g, 'الوكالة');
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated translations in ${file}`);
});
