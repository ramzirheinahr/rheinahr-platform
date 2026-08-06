import { formatInTimeZone } from 'date-fns-tz';
console.log(formatInTimeZone(new Date(), 'Europe/Berlin', "dd.MM.yyyy 'um' HH:mm"));
