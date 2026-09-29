import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
dayjs.extend(utc); dayjs.extend(timezone);
export { dayjs };
export const dateLabel = (value?: string) => value ? dayjs(value.slice(0, 10)).format('D MMM YYYY') : 'No date';
export const dateInput = (value: string) => value ? dayjs(value).format('DD/MM/YYYY') : '';
export function parseDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error('Use DD/MM/YYYY for dates.');
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  if (dayjs(iso).format('YYYY-MM-DD') !== iso) throw new Error('Enter a valid date.');
  return iso;
}
export const dateTimeInput = (value: string, zone: string) => value ? dayjs(value).tz(zone).format('DD/MM/YYYY HH:mm') : '';
export function parseDateTime(value: string, zone: string) {
  const [d, t] = value.trim().split(' ');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t || '')) throw new Error('Use DD/MM/YYYY HH:mm for date and time.');
  return dayjs.tz(`${parseDate(d)} ${t}`, zone).toISOString();
}
export const money = (cents: number = 0, currency = 'EUR') => new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(cents / 100);
export const number2 = (value?: number | null) => value == null ? '—' : value.toFixed(2);
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);