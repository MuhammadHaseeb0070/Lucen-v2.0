let adminEmails: string[] = [];

export function setAdminEmails(emails: string[]) {
    adminEmails = emails.map((e: string) => e.trim().toLowerCase()).filter(Boolean);
}

export function isAdminUser(email?: string | null): boolean {
    if (!email || adminEmails.length === 0) return false;
    return adminEmails.includes(email.toLowerCase());
}
