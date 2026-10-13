const axios = require('axios');
const { httpError } = require('../utils/errors');

let warnedUnconfigured = false;

// country > state > district > sub-district > city > postal code. Each level
// is listed under its parent by organization-admin-service's /geography routes.
const LEVELS = [
  { key: 'countryId', label: 'Country', path: '/geography/countries', parent: null },
  { key: 'stateId', label: 'State', path: '/geography/states', parent: 'countryId' },
  { key: 'districtId', label: 'District', path: '/geography/districts', parent: 'stateId' },
  { key: 'subDistrictId', label: 'Sub-district', path: '/geography/sub-districts', parent: 'districtId' },
  { key: 'cityId', label: 'City', path: '/geography/cities', parent: 'subDistrictId' },
  { key: 'postalCodeId', label: 'Postal code', path: '/geography/postal-codes', parent: 'cityId' },
];
const LABELS = Object.fromEntries(LEVELS.map((l) => [l.key, l.label]));

const baseUrl = () => (process.env.ORGANIZATION_SERVICE_URL || '').replace(/\/+$/, '');

async function fetchList(path, query, tenantUuid) {
  try {
    const response = await axios.get(`${baseUrl()}${path}`, {
      params: query,
      timeout: 8000,
      headers: {
        // /geography is reference data behind the shared internal token (a
        // browser can't hold it). This service is a trusted server, so it
        // presents the token itself instead of forwarding the user's JWT.
        Authorization: `Bearer ${process.env.ORGANIZATION_SERVICE_INTERNAL_TOKEN}`,
        'X-Tenant-Uuid': tenantUuid,
      },
    });
    const body = response.data;
    return body?.data || body?.items || [];
  } catch (error) {
    throw httpError(502, 'GEOGRAPHY_UNAVAILABLE', 'Could not verify the address with organization-admin-service');
  }
}

/**
 * Checks that the geography ids form a real chain (each level belongs to the
 * level above it) and returns the display name of every level that was given:
 *   { countryId: 'India', stateId: 'Uttar Pradesh', ..., postalCodeId: '247001' }
 *
 * The browser only ever sends ids; names are looked up here, so a list or
 * search never shows a name that disagrees with its id.
 *
 * Returns null (skipping the check) when ORGANIZATION_SERVICE_URL or
 * ORGANIZATION_SERVICE_INTERNAL_TOKEN is unset — local dev / tests only.
 */
async function resolveAddress(ids, { tenantUuid }) {
  if (!baseUrl() || !process.env.ORGANIZATION_SERVICE_INTERNAL_TOKEN) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn('[patient-service] ORGANIZATION_SERVICE_URL / ORGANIZATION_SERVICE_INTERNAL_TOKEN not set: geography ids are NOT being verified and address names are not filled in.');
    }
    return null;
  }

  const names = {};
  for (const level of LEVELS) {
    const id = ids[level.key];
    if (!id) continue;
    if (level.parent && !ids[level.parent]) {
      throw httpError(400, 'INVALID_ADDRESS', `${level.label} needs ${LABELS[level.parent].toLowerCase()} to be chosen first`);
    }
    const rows = await fetchList(level.path, level.parent ? { [level.parent]: ids[level.parent] } : {}, tenantUuid);
    const row = rows.find((r) => Number(r[level.key]) === Number(id));
    if (!row) {
      throw httpError(
        400,
        'INVALID_ADDRESS',
        level.parent
          ? `${level.label} ${id} does not belong to the selected ${LABELS[level.parent].toLowerCase()}`
          : `${level.label} ${id} does not exist`,
      );
    }
    names[level.key] = level.key === 'postalCodeId' ? row.code : row.name;
  }
  return names;
}

module.exports = { resolveAddress };
