const XLSX = require('xlsx');
const text = "Datum\tSchicht\tVon\tBis\n2026-07-21\tearly\t06:30\t14:00";
const wb = XLSX.read(text, { type: 'string' });
const ws = wb.Sheets[wb.SheetNames[0]];
console.log(XLSX.utils.sheet_to_json(ws));
