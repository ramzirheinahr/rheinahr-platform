import { formatInTimeZone } from 'date-fns-tz';

/**
 * Formats a date using the Europe/Berlin timezone.
 * This ensures that dates are always displayed in the German time zone
 * regardless of the server's or client's local time zone.
 * 
 * @param date The date to format (Date, string, or timestamp)
 * @param formatStr The date-fns format string
 * @param options Optional formatting options
 * @returns Formatted date string
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function format(date: Date | string | number, formatStr: string, options?: any): string {
  return formatInTimeZone(date, 'Europe/Berlin', formatStr, options);
}
