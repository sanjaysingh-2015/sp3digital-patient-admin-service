const { Op } = require('sequelize');
const { sequelize, Patient, TenantPatientSetting } = require('../models');
const { logAccess } = require('../services/patientService');
const { DEFAULT_RETENTION_MONTHS } = require('../services/settingsService');

/**
 * Patients that have been INACTIVE or DELETED for longer than the tenant's
 * retention period (default 6 months, configurable per tenant) have their
 * personal details wiped and become ANONYMIZED. The row, its uuid and its
 * patient numbers stay so references from appointments still resolve; the
 * appointment service's own name/phone snapshots are handled there.
 *
 * Dry run by default: pass { apply: true } to actually change anything.
 */
async function runAnonymization({ apply = false, now = new Date() } = {}) {
  const tenantRows = await Patient.findAll({
    where: { status: { [Op.in]: ['INACTIVE', 'DELETED'] }, inactive_since: { [Op.ne]: null } },
    attributes: ['tenantUuid'],
    group: ['tenant_uuid'],
  });

  const summary = { tenants: tenantRows.length, candidates: 0, anonymized: 0, apply };
  for (const { tenantUuid } of tenantRows) {
    const setting = await TenantPatientSetting.findByPk(tenantUuid);
    const months = setting?.retentionMonths ?? DEFAULT_RETENTION_MONTHS;
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months);

    const due = await Patient.findAll({
      where: { tenant_uuid: tenantUuid, status: { [Op.in]: ['INACTIVE', 'DELETED'] }, inactive_since: { [Op.lt]: cutoff } },
    });
    summary.candidates += due.length;
    if (!apply) continue;

    for (const patient of due) {
      await sequelize.transaction(async (transaction) => {
        await patient.update(
          {
            username: `anonymized-${patient.patientUuid}`,
            displayName: 'Anonymized patient',
            firstName: 'Anonymized',
            title: null, middleName: null, lastName: null, gender: null,
            dateOfBirth: null, estimatedAgeYears: null, estimatedAgeOn: null, preferredLanguage: null,
            phoneNumber: '', alternatePhoneNumber: null, email: null,
            addressLine1: null, addressLine2: null,
            countryId: null, stateId: null, districtId: null, subDistrictId: null, cityId: null, postalCodeId: null,
            city: null, subDistrictName: null, districtName: null, stateName: null, countryName: null, postalCode: null,
            emergencyContactName: null, emergencyContactRelationship: null, emergencyContactPhone: null,
            guardianPatientId: null, guardianRelationship: null,
            abhaNumber: null, abhaAddress: null, idProofType: null, idProofLast4: null, notes: null,
            status: 'ANONYMIZED',
            anonymizedOn: now,
            modifiedOn: now,
          },
          { transaction },
        );
        await logAccess({ tenantUuid, patientId: patient.patientId, action: 'ANONYMIZE', details: `retention ${months} months` }, transaction);
      });
      summary.anonymized += 1;
    }
  }
  return summary;
}

module.exports = { runAnonymization };
