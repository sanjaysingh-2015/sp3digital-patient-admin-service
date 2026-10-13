/** Small pure helpers shared by the service and the tests. */

/**
 * Digits only, so "98765 43210" and "98765-43210" compare equal. A number typed
 * with a leading "+" and the patient's own country code ("+91 98765 43210") has
 * that code removed, because the country code is stored in its own column.
 */
function normalizePhone(value, countryCode) {
  if (!value) return value;
  const raw = String(value).trim();
  let digits = raw.replace(/\D/g, '');
  const code = countryCode ? String(countryCode).replace(/\D/g, '') : '';
  if (raw.startsWith('+') && code && digits.startsWith(code)) digits = digits.slice(code.length);
  return digits;
}

/** XXXXXX3210 — enough for staff to confirm "the one ending 3210" without exposing the number in a list. */
function maskPhone(phone) {
  if (!phone) return null;
  const digits = String(phone);
  return `${'X'.repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`;
}

/** a***@example.com */
function maskEmail(email) {
  if (!email) return null;
  const [name, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${name.slice(0, 1)}***@${domain}`;
}

const isoDay = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);

/**
 * Whole years old. A known date of birth wins; otherwise the estimate given on
 * a particular day keeps advancing with the calendar. Null when neither is known.
 */
function ageInYears({ dateOfBirth, estimatedAgeYears, estimatedAgeOn }, now = new Date()) {
  const yearsBetween = (fromDate) => {
    const from = new Date(fromDate);
    let years = now.getUTCFullYear() - from.getUTCFullYear();
    const beforeAnniversary =
      now.getUTCMonth() < from.getUTCMonth() ||
      (now.getUTCMonth() === from.getUTCMonth() && now.getUTCDate() < from.getUTCDate());
    if (beforeAnniversary) years -= 1;
    return Math.max(years, 0);
  };
  if (dateOfBirth) return yearsBetween(dateOfBirth);
  if (estimatedAgeYears !== null && estimatedAgeYears !== undefined) {
    return estimatedAgeYears + (estimatedAgeOn ? yearsBetween(estimatedAgeOn) : 0);
  }
  return null;
}

const minorAgeYears = () => Number(process.env.MINOR_AGE_YEARS) || 18;

/** True only when the age is known and below the limit; unknown age is treated as an adult. */
const isMinor = (patient, now) => {
  const age = ageInYears(patient, now);
  return age !== null && age < minorAgeYears();
};

const buildDisplayName = (p) => [p.title, p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ').trim();

module.exports = { normalizePhone, maskPhone, maskEmail, isoDay, ageInYears, isMinor, minorAgeYears, buildDisplayName };
