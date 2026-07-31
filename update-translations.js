const fs = require('fs');
const files = ['messages/de.json', 'messages/en.json', 'messages/ar.json'];

const additions = {
  de: {
    activeSessionsTitle: "Aktive Sitzungen",
    activeSessionsDesc: "Angemeldete Geräte und Browser für dieses Konto.",
    confirmRevokeSession: "Möchten Sie diese Sitzung wirklich abmelden?",
    sessionRevoked: "Sitzung erfolgreich abgemeldet.",
    revokeSession: "Sitzung beenden",
    lastActive: "Zuletzt aktiv"
  },
  en: {
    activeSessionsTitle: "Active Sessions",
    activeSessionsDesc: "Logged-in devices and browsers for this account.",
    confirmRevokeSession: "Are you sure you want to revoke this session?",
    sessionRevoked: "Session successfully revoked.",
    revokeSession: "Revoke Session",
    lastActive: "Last Active"
  },
  ar: {
    activeSessionsTitle: "الجلسات النشطة",
    activeSessionsDesc: "الأجهزة والمتصفحات المسجلة في هذا الحساب.",
    confirmRevokeSession: "هل أنت متأكد من رغبتك في طرد هذه الجلسة؟",
    sessionRevoked: "تم طرد الجلسة بنجاح.",
    revokeSession: "طرد الجلسة",
    lastActive: "آخر نشاط"
  }
};

files.forEach(file => {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const lang = file.includes('de') ? 'de' : file.includes('en') ? 'en' : 'ar';
  
  // Add to common
  Object.assign(data.common, additions[lang]);
  
  // Also add to clients and workers just in case we miss a reference
  if (!data.clients) data.clients = {};
  if (!data.workers) data.workers = {};
  Object.assign(data.clients, additions[lang]);
  Object.assign(data.workers, additions[lang]);

  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
});
console.log('Translations updated.');
