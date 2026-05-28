const PERSONAL_EMAIL_DOMAINS = new Set([
  "aol.com",
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mac.com",
  "me.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.com",
]);

function getEmailDomain(email: string | null | undefined): string | null {
  if (!email) {
    return null;
  }

  const trimmedEmail = email.trim().toLowerCase();
  const atIndex = trimmedEmail.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === trimmedEmail.length - 1) {
    return null;
  }

  const domain = trimmedEmail.slice(atIndex + 1);
  return PERSONAL_EMAIL_DOMAINS.has(domain) ? null : domain;
}

export function getAllowedEmailDomains(): Set<string> {
  const domains = new Set<string>();

  for (const rawDomain of (
    process.env.OPEN_AGENTS_ALLOWED_EMAIL_DOMAINS ?? ""
  ).split(",")) {
    const domain = rawDomain.trim().toLowerCase();
    if (domain && !PERSONAL_EMAIL_DOMAINS.has(domain)) {
      domains.add(domain);
    }
  }

  return domains;
}

export function isEmailAllowedToAuthenticate(
  email: string | null | undefined,
): boolean {
  const allowedDomains = getAllowedEmailDomains();
  if (allowedDomains.size === 0) {
    return true;
  }

  const domain = getEmailDomain(email);
  return domain !== null && allowedDomains.has(domain);
}

export function getAllowedOrganizationEmailDomain(
  email: string | null | undefined,
): string | null {
  const domain = getEmailDomain(email);
  if (!domain) {
    return null;
  }

  const allowedDomains = getAllowedEmailDomains();
  if (allowedDomains.size === 0 || !allowedDomains.has(domain)) {
    return null;
  }

  return domain;
}
