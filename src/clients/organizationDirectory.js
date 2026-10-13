const axios = require('axios');
const { httpError } = require('../utils/errors');

let warnedUnconfigured = false;
const baseUrl = () => (process.env.ORGANIZATION_SERVICE_URL || '').replace(/\/+$/, '');

/**
 * Confirms the registering facility exists in the caller's tenant and returns
 * it (its facilityCode prefixes the patient numbers). The caller's own bearer
 * token is forwarded, so organization-admin-service's tenant scoping decides
 * visibility: another tenant's facility answers 404.
 *
 * Returns null (check skipped) when ORGANIZATION_SERVICE_URL is unset or the
 * caller is an internal service with no user token — local dev / tests only.
 */
async function getFacility(facilityId, token) {
  if (!baseUrl() || !token) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn('[patient-service] ORGANIZATION_SERVICE_URL is not set: facility ids are NOT being verified.');
    }
    return null;
  }
  try {
    const response = await axios.get(`${baseUrl()}/facilities/${facilityId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    });
    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
      throw httpError(400, 'INVALID_FACILITY', 'That facility does not exist in this tenant');
    }
    throw httpError(502, 'ORGANIZATION_SERVICE_UNAVAILABLE', 'Could not verify the facility with organization-admin-service');
  }
}

module.exports = { getFacility };
