import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export function formatDuration(s: number) { return `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`; }
export function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
