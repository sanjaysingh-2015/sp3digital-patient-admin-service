const { Op } = require('sequelize');
const {
  sequelize,
  Patient,
  PatientFacilityNumber,
  PatientNumberSequence,
  PatientMerge,
  PatientAccessLog,
} = require('../models');
const { toSequelizePage, buildEnvelope } = require('../utils/pagination');
const { httpError, patientNotFound } = require('../utils/errors');
const { normalizePhone, maskPhone, maskEmail, ageInYears, isMinor, minorAgeYears, buildDisplayName } = require('../utils/patient.util');
const { getFacility } = require('../clients/organizationDirectory');
const { resolveAddress } = require('../clients/geographyDirectory');

const FIELDS = [
  'username', 'title', 'firstName', 'middleName', 'lastName', 'displayName', 'gender', 'dateOfBirth', 'estimatedAgeYears',
  'preferredLanguage', 'phoneCountryCode', 'phoneNumber', 'alternatePhoneNumber', 'email', 'addressLine1', 'addressLine2',
  'countryId', 'stateId', 'districtId', 'subDistrictId', 'cityId', 'postalCodeId',
  'emergencyContactName', 'emergencyContactRelationship', 'emergencyContactPhone', 'guardianPatientId', 'guardianRelationship',
  'abhaNumber', 'abhaAddress', 'idProofType', 'idProofLast4', 'notes',
];
const NAME_PARTS = ['title', 'firstName', 'middleName', 'lastName'];
const GEO_NAME_COLUMN = {
  countryId: 'countryName', stateId: 'stateName', districtId: 'districtName',
  subDistrictId: 'subDistrictName', cityId: 'city', postalCodeId: 'postalCode',
};
const HIDDEN_STATUSES = ['DELETED', 'MERGED', 'ANONYMIZED'];

const blankToNull = (value) => (value === '' ? null : value);
const plainOf = (row) => (row.get ? row.get({ plain: true }) : row);
const today = () => new Date().toISOString().slice(0, 10);

async function logAccess({ tenantUuid, patientId, action, userId, details }, transaction) {
  await PatientAccessLog.create({ tenantUuid, patientId, action, userId: userId || null, details: details ? String(details).slice(0, 500) : null }, { transaction });
}

/** Next number for a facility, issued under a row lock so two registrations can never get the same one. */
async function issueNumber({ tenantUuid, facilityId, facilityCode, userId, patientId }, transaction) {
  const lookup = { where: { tenant_uuid: tenantUuid, facility_id: facilityId }, transaction };
  if (sequelize.getDialect() === 'mysql') lookup.lock = transaction.LOCK.UPDATE;

  let sequence = await PatientNumberSequence.findOne(lookup);
  if (!sequence) {
    try {
      sequence = await PatientNumberSequence.create({ tenantUuid, facilityId, lastNumber: 0 }, { transaction });
    } catch (error) {
      if (error.name !== 'SequelizeUniqueConstraintError') throw error;
      sequence = await PatientNumberSequence.findOne(lookup);
    }
  }
  const next = sequence.lastNumber + 1;
  await sequence.update({ lastNumber: next }, { transaction });

  const prefix = facilityCode || `F${facilityId}`;
  const patientNumber = `${prefix}-${String(next).padStart(6, '0')}`;
  await PatientFacilityNumber.create({ patientId, facilityId, tenantUuid, patientNumber, issuedBy: userId || null }, { transaction });
  return patientNumber;
}

/** Validate the whole address chain and return the id + name columns to write. */
async function resolveGeoColumns(patch, stored, ctx) {
  const touched = Object.keys(GEO_NAME_COLUMN).some((key) => patch[key] !== undefined);
  if (!touched) return {};
  const effective = {};
  for (const key of Object.keys(GEO_NAME_COLUMN)) {
    effective[key] = patch[key] !== undefined ? patch[key] : (stored ? stored[key] : null) ?? null;
  }
  const names = await resolveAddress(effective, ctx);
  if (names === null) return {}; // geography check not configured — keep what was sent
  const columns = {};
  for (const [key, nameColumn] of Object.entries(GEO_NAME_COLUMN)) {
    columns[key] = effective[key] || null;
    columns[nameColumn] = names[key] ?? null;
  }
  return columns;
}

function toSummary(patient) {
  const p = plainOf(patient);
  return {
    patientId: p.patientId,
    patientUuid: p.patientUuid,
    patientNumber: p.registrationNumber,
    username: p.username,
    displayName: p.displayName,
    gender: p.gender,
    age: ageInYears(p),
    ageIsEstimated: !p.dateOfBirth && p.estimatedAgeYears !== null && p.estimatedAgeYears !== undefined,
    isMinor: isMinor(p),
    phoneCountryCode: p.phoneCountryCode,
    phoneMasked: maskPhone(p.phoneNumber),
    emailMasked: maskEmail(p.email),
    registrationFacilityId: p.registrationFacilityId,
    status: p.status,
    createdOn: p.createdOn,
  };
}

async function toDetail(patient) {
  const p = plainOf(patient);
  const numbers = await PatientFacilityNumber.findAll({ where: { patient_id: p.patientId }, order: [['issuedOn', 'ASC']] });
  const out = {
    ...p,
    age: ageInYears(p),
    ageIsEstimated: !p.dateOfBirth && p.estimatedAgeYears !== null && p.estimatedAgeYears !== undefined,
    isMinor: isMinor(p),
    patientNumber: p.registrationNumber,
    facilityNumbers: numbers.map((n) => ({ facilityId: n.facilityId, patientNumber: n.patientNumber, issuedOn: n.issuedOn })),
    guardian: null,
  };
  delete out.tenantUuid;
  if (p.guardianPatientId) {
    const guardian = await Patient.findByPk(p.guardianPatientId);
    if (guardian) {
      out.guardian = {
        patientId: guardian.patientId,
        patientUuid: guardian.patientUuid,
        displayName: guardian.displayName,
        patientNumber: guardian.registrationNumber,
        phoneMasked: maskPhone(guardian.phoneNumber),
        relationship: p.guardianRelationship,
      };
    }
  }
  return out;
}

class PatientService {
  async #findOwned(patientId, tenantUuid, transaction) {
    const patient = await Patient.findOne({ where: { patient_id: patientId, tenant_uuid: tenantUuid }, transaction });
    if (!patient) throw patientNotFound();
    return patient;
  }

  async #assertUsernameFree(tenantUuid, username, excludePatientId) {
    const where = { tenant_uuid: tenantUuid, username };
    if (excludePatientId) where.patient_id = { [Op.ne]: excludePatientId };
    if (await Patient.findOne({ where, attributes: ['patientId'] })) {
      throw httpError(409, 'USERNAME_TAKEN', `The username "${username}" is already used by another patient`);
    }
  }

  /** A minor needs a guardian who is a registered, adult patient of the same tenant. */
  async #checkGuardian(tenantUuid, effective, selfPatientId) {
    if (isMinor(effective) && !effective.guardianPatientId) {
      throw httpError(400, 'GUARDIAN_REQUIRED', `A patient under ${minorAgeYears()} needs a guardian who is a registered patient`);
    }
    if (!effective.guardianPatientId) return;
    if (selfPatientId && Number(effective.guardianPatientId) === Number(selfPatientId)) {
      throw httpError(400, 'INVALID_GUARDIAN', 'A patient cannot be their own guardian');
    }
    const guardian = await Patient.findOne({ where: { patient_id: effective.guardianPatientId, tenant_uuid: tenantUuid } });
    if (!guardian || HIDDEN_STATUSES.includes(guardian.status)) {
      throw httpError(400, 'INVALID_GUARDIAN', 'The guardian must be a registered patient in this tenant');
    }
    if (isMinor(guardian)) throw httpError(400, 'INVALID_GUARDIAN', 'A guardian must be an adult');
  }

  async #findCandidates(tenantUuid, { phoneNumber, firstName, dateOfBirth }) {
    const first = firstName.trim();
    const or = [{ phone_number: phoneNumber, first_name: { [Op.like]: `${first.slice(0, 3)}%` } }];
    if (dateOfBirth) or.push({ date_of_birth: dateOfBirth, first_name: { [Op.like]: `${first.slice(0, 3)}%` } });
    const rows = await Patient.findAll({
      where: { tenant_uuid: tenantUuid, status: { [Op.in]: ['ACTIVE', 'INACTIVE'] }, [Op.or]: or },
      limit: 5,
      order: [['createdOn', 'DESC']],
    });
    return rows.map(toSummary);
  }

  async create(payload, ctx) {
    const { tenantUuid, userId, token } = ctx;
    const facility = await getFacility(payload.registrationFacilityId, token);

    const phoneNumber = normalizePhone(payload.phoneNumber, payload.phoneCountryCode || '+91');
    if (phoneNumber.length < 6 || phoneNumber.length > 15) {
      throw httpError(400, 'VALIDATION_ERROR', 'phoneNumber must have between 6 and 15 digits');
    }

    await this.#assertUsernameFree(tenantUuid, payload.username);

    const effectiveAge = {
      dateOfBirth: payload.dateOfBirth || null,
      estimatedAgeYears: payload.dateOfBirth ? null : payload.estimatedAgeYears ?? null,
      estimatedAgeOn: payload.estimatedAgeYears !== undefined && payload.estimatedAgeYears !== null && !payload.dateOfBirth ? today() : null,
    };
    await this.#checkGuardian(tenantUuid, { ...effectiveAge, guardianPatientId: payload.guardianPatientId }, null);

    if (!payload.allowDuplicate) {
      const candidates = await this.#findCandidates(tenantUuid, { phoneNumber, firstName: payload.firstName, dateOfBirth: payload.dateOfBirth });
      if (candidates.length) {
        const error = httpError(
          409,
          'DUPLICATE_CANDIDATES',
          'A patient with the same phone number and a similar name (or the same date of birth) already exists. Open that patient, or confirm this is a different person.',
        );
        error.candidates = candidates;
        throw error;
      }
    }

    const geoColumns = await resolveGeoColumns(payload, null, ctx);

    const patientId = await sequelize.transaction(async (transaction) => {
      const values = {};
      for (const field of FIELDS) if (payload[field] !== undefined) values[field] = blankToNull(payload[field]);
      Object.assign(values, geoColumns, effectiveAge, {
        phoneNumber,
        alternatePhoneNumber: normalizePhone(blankToNull(payload.alternatePhoneNumber), payload.phoneCountryCode || '+91') || null,
        emergencyContactPhone: normalizePhone(blankToNull(payload.emergencyContactPhone), payload.phoneCountryCode || '+91') || null,
        phoneCountryCode: payload.phoneCountryCode || '+91',
        displayName: buildDisplayName(payload),
      });

      let patient;
      try {
        patient = await Patient.create(
          { ...values, tenantUuid, registrationFacilityId: payload.registrationFacilityId, status: 'ACTIVE', createdBy: userId || null, modifiedBy: userId || null },
          { transaction },
        );
      } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') throw httpError(409, 'USERNAME_TAKEN', 'That username was just taken by another patient');
        throw error;
      }

      const number = await issueNumber(
        { tenantUuid, facilityId: payload.registrationFacilityId, facilityCode: facility?.facilityCode, userId, patientId: patient.patientId },
        transaction,
      );
      await patient.update({ registrationNumber: number }, { transaction });
      await logAccess({ tenantUuid, patientId: patient.patientId, action: 'CREATE', userId, details: `facility ${payload.registrationFacilityId}, number ${number}` }, transaction);
      return patient.patientId;
    });

    return toDetail(await this.#findOwned(patientId, tenantUuid));
  }

  /** Full record. Every full view is written to the access log. */
  async getById(patientId, { tenantUuid, userId }) {
    const patient = await this.#findOwned(patientId, tenantUuid);
    await logAccess({ tenantUuid, patientId, action: 'VIEW', userId });
    return toDetail(patient);
  }

  /** For other services (e.g. appointments) that hold the patient's uuid as patient_ref. */
  async getByUuid(uuid, { tenantUuid, userId }) {
    const patient = await Patient.findOne({ where: { patient_uuid: uuid, tenant_uuid: tenantUuid } });
    if (!patient) throw patientNotFound();
    await logAccess({ tenantUuid, patientId: patient.patientId, action: 'LOOKUP', userId });
    return {
      patientId: patient.patientId,
      patientUuid: patient.patientUuid,
      patientNumber: patient.registrationNumber,
      displayName: patient.displayName,
      phoneCountryCode: patient.phoneCountryCode,
      phoneNumber: patient.phoneNumber,
      email: patient.email,
      status: patient.status,
    };
  }

  async search({ q, status, facilityId, page, limit }, { tenantUuid }) {
    const { limit: safeLimit, offset, page: safePage } = toSequelizePage({ page, limit });
    const where = { tenant_uuid: tenantUuid };
    where.status = status ? status : { [Op.notIn]: HIDDEN_STATUSES };

    if (q) {
      const like = { [Op.like]: `%${q}%` };
      const digits = q.replace(/\D/g, '');
      const byNumber = await PatientFacilityNumber.findAll({ where: { tenant_uuid: tenantUuid, patient_number: like }, attributes: ['patientId'] });
      const or = [{ display_name: like }, { username: like }, { registration_number: like }, { patient_id: { [Op.in]: byNumber.map((n) => n.patientId) } }];
      if (digits.length >= 4) or.push({ phone_number: { [Op.like]: `%${digits}%` } });
      where[Op.or] = or;
    }
    if (facilityId) {
      const rows = await PatientFacilityNumber.findAll({ where: { tenant_uuid: tenantUuid, facility_id: facilityId }, attributes: ['patientId'] });
      where.patient_id = { [Op.in]: rows.map((r) => r.patientId) };
    }

    const result = await Patient.findAndCountAll({ where, limit: safeLimit, offset, order: [['displayName', 'ASC'], ['patientId', 'ASC']] });
    return buildEnvelope({ rows: result.rows.map(toSummary), count: result.count }, { page: safePage, limit: safeLimit });
  }

  async usernameAvailable({ username, excludePatientId }, { tenantUuid }) {
    const where = { tenant_uuid: tenantUuid, username };
    if (excludePatientId) where.patient_id = { [Op.ne]: excludePatientId };
    return { username, available: !(await Patient.findOne({ where, attributes: ['patientId'] })) };
  }

  async update(patientId, patch, ctx) {
    const { tenantUuid, userId } = ctx;
    const patient = await this.#findOwned(patientId, tenantUuid);
    if (['MERGED', 'ANONYMIZED', 'DELETED'].includes(patient.status)) {
      throw httpError(409, 'PATIENT_NOT_EDITABLE', `A ${patient.status.toLowerCase()} patient cannot be edited`);
    }

    const changes = {};
    for (const field of FIELDS) if (patch[field] !== undefined) changes[field] = blankToNull(patch[field]);

    const countryCode = patch.phoneCountryCode || patient.phoneCountryCode;
    if (patch.phoneNumber !== undefined) {
      changes.phoneNumber = normalizePhone(patch.phoneNumber, countryCode);
      if (changes.phoneNumber.length < 6 || changes.phoneNumber.length > 15) {
        throw httpError(400, 'VALIDATION_ERROR', 'phoneNumber must have between 6 and 15 digits');
      }
    }
    for (const key of ['alternatePhoneNumber', 'emergencyContactPhone']) {
      if (patch[key] !== undefined) changes[key] = normalizePhone(blankToNull(patch[key]), countryCode) || null;
    }
    if (patch.username !== undefined && patch.username !== patient.username) {
      await this.#assertUsernameFree(tenantUuid, patch.username, patientId);
    }

    // Age: a date of birth wins; an estimate is stamped with today so it keeps advancing.
    if (patch.dateOfBirth) {
      changes.estimatedAgeYears = null;
      changes.estimatedAgeOn = null;
    } else if (patch.estimatedAgeYears !== undefined) {
      changes.estimatedAgeOn = patch.estimatedAgeYears === null ? null : today();
    }
    const effective = {
      dateOfBirth: 'dateOfBirth' in changes ? changes.dateOfBirth : patient.dateOfBirth,
      estimatedAgeYears: 'estimatedAgeYears' in changes ? changes.estimatedAgeYears : patient.estimatedAgeYears,
      estimatedAgeOn: 'estimatedAgeOn' in changes ? changes.estimatedAgeOn : patient.estimatedAgeOn,
      guardianPatientId: 'guardianPatientId' in changes ? changes.guardianPatientId : patient.guardianPatientId,
    };
    await this.#checkGuardian(tenantUuid, effective, patientId);

    if (NAME_PARTS.some((k) => patch[k] !== undefined)) {
      changes.displayName = buildDisplayName({
        title: 'title' in changes ? changes.title : patient.title,
        firstName: 'firstName' in changes ? changes.firstName : patient.firstName,
        middleName: 'middleName' in changes ? changes.middleName : patient.middleName,
        lastName: 'lastName' in changes ? changes.lastName : patient.lastName,
      });
    }
    Object.assign(changes, await resolveGeoColumns(patch, patient, ctx));

    // The audit entry names the fields that changed — never their values.
    const changedFields = Object.keys(changes).filter((key) => FIELDS.includes(key) && String(patient[key] ?? '') !== String(changes[key] ?? ''));

    await sequelize.transaction(async (transaction) => {
      await patient.update({ ...changes, modifiedBy: userId || null, modifiedOn: new Date() }, { transaction });
      await logAccess({ tenantUuid, patientId, action: 'UPDATE', userId, details: changedFields.join(', ') }, transaction);
    });
    return toDetail(await this.#findOwned(patientId, tenantUuid));
  }

  async setStatus(patientId, status, { tenantUuid, userId }) {
    const patient = await this.#findOwned(patientId, tenantUuid);
    if (['MERGED', 'ANONYMIZED'].includes(patient.status)) {
      throw httpError(409, 'PATIENT_NOT_EDITABLE', `A ${patient.status.toLowerCase()} patient cannot change status`);
    }
    const before = patient.status;
    const changes = { status, modifiedBy: userId || null, modifiedOn: new Date() };
    // The retention clock runs while a record is inactive or deleted.
    if (status === 'ACTIVE') changes.inactiveSince = null;
    else if (!patient.inactiveSince) changes.inactiveSince = new Date();

    await sequelize.transaction(async (transaction) => {
      await patient.update(changes, { transaction });
      await logAccess({ tenantUuid, patientId, action: 'STATUS', userId, details: `${before} -> ${status}` }, transaction);
    });
    return toDetail(await this.#findOwned(patientId, tenantUuid));
  }

  /** Each facility issues its own number; asking again for the same facility returns the existing one. */
  async issueFacilityNumber(patientId, facilityId, ctx) {
    const { tenantUuid, userId, token } = ctx;
    const patient = await this.#findOwned(patientId, tenantUuid);
    if (HIDDEN_STATUSES.includes(patient.status)) throw httpError(409, 'PATIENT_NOT_EDITABLE', 'This patient cannot be given a new number');

    const existing = await PatientFacilityNumber.findOne({ where: { patient_id: patientId, facility_id: facilityId } });
    if (!existing) {
      const facility = await getFacility(facilityId, token);
      await sequelize.transaction(async (transaction) => {
        const number = await issueNumber({ tenantUuid, facilityId, facilityCode: facility?.facilityCode, userId, patientId }, transaction);
        await logAccess({ tenantUuid, patientId, action: 'NUMBER', userId, details: `facility ${facilityId}, number ${number}` }, transaction);
      });
    }
    return toDetail(await this.#findOwned(patientId, tenantUuid));
  }

  /** Fold a duplicate (source) into the surviving record (target). Nothing is deleted. */
  async merge(targetPatientId, { sourcePatientId, reason }, { tenantUuid, userId }) {
    if (Number(targetPatientId) === Number(sourcePatientId)) throw httpError(400, 'INVALID_MERGE', 'A patient cannot be merged into itself');

    await sequelize.transaction(async (transaction) => {
      const target = await this.#findOwned(targetPatientId, tenantUuid, transaction);
      const source = await this.#findOwned(sourcePatientId, tenantUuid, transaction);
      for (const p of [target, source]) {
        if (!['ACTIVE', 'INACTIVE'].includes(p.status)) throw httpError(409, 'INVALID_MERGE', 'Only active or inactive patients can be merged');
      }

      // Facility numbers the survivor does not have yet move across; the rest stay on the old record for reference.
      const targetFacilities = (await PatientFacilityNumber.findAll({ where: { patient_id: target.patientId }, transaction })).map((n) => n.facilityId);
      await PatientFacilityNumber.update(
        { patientId: target.patientId },
        { where: { patient_id: source.patientId, facility_id: { [Op.notIn]: targetFacilities.length ? targetFacilities : [0] } }, transaction },
      );

      // Anyone who had the duplicate as guardian now has the survivor.
      await Patient.update({ guardianPatientId: target.patientId }, { where: { guardian_patient_id: source.patientId, tenant_uuid: tenantUuid }, transaction });

      await source.update({ status: 'MERGED', mergedIntoPatientId: target.patientId, inactiveSince: source.inactiveSince || new Date(), modifiedBy: userId || null, modifiedOn: new Date() }, { transaction });
      await PatientMerge.create({ tenantUuid, sourcePatientId: source.patientId, targetPatientId: target.patientId, reason: reason || null, mergedBy: userId || null }, { transaction });
      await logAccess({ tenantUuid, patientId: target.patientId, action: 'MERGE', userId, details: `absorbed patient ${source.patientId}` }, transaction);
      await logAccess({ tenantUuid, patientId: source.patientId, action: 'MERGE', userId, details: `merged into patient ${target.patientId}` }, transaction);
    });
    return toDetail(await this.#findOwned(targetPatientId, tenantUuid));
  }

  async listAudit(patientId, { page, limit }, { tenantUuid }) {
    await this.#findOwned(patientId, tenantUuid);
    const { limit: safeLimit, offset, page: safePage } = toSequelizePage({ page, limit });
    const result = await PatientAccessLog.findAndCountAll({
      where: { tenant_uuid: tenantUuid, patient_id: patientId },
      order: [['createdOn', 'DESC'], ['logId', 'DESC']],
      limit: safeLimit,
      offset,
    });
    return buildEnvelope(
      { rows: result.rows.map((r) => ({ logId: r.logId, action: r.action, userId: r.userId, details: r.details, createdOn: r.createdOn })), count: result.count },
      { page: safePage, limit: safeLimit },
    );
  }
}

module.exports = new PatientService();
module.exports.logAccess = logAccess;
