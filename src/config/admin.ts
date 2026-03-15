const ADMIN_EMAILS: string[] = (import.meta.env.VITE_ADMIN_EMAILS || '')
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);

export function isAdminUser(email?: string | null): boolean {
    if (!email || ADMIN_EMAILS.length === 0) return false;
    return ADMIN_EMAILS.includes(email.toLowerCase());
}
