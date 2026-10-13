const { Joi } = require('../middleware/validate');
const { paginationQuerySchema } = require('../utils/pagination');

const GENDERS = ['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED'];
const STATUSES = ['ACTIVE', 'INACTIVE', 'DELETED']; // what a caller may set; MERGED / ANONYMIZED are system-set
const ALL_STATUSES = [...STATUSES, 'MERGED', 'ANONYMIZED'];

const text = (max) => Joi.string().trim().max(max).allow('', null);
const positiveId = Joi.number().integer().positive();

const dateOnly = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom((value, helpers) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      return helpers.message('must be a valid date in YYYY-MM-DD format');
    }
    if (parsed.getTime() > Date.now()) return helpers.message('must not be in the future');
    return value;
  });

// Digits (with the usual separators) — the service stores digits only.
const phone = Joi.string().trim().pattern(/^[0-9+\-\s()]{6,20}$/).message('must be a valid phone number');

const fields = {
  username: Joi.string().trim().lowercase().pattern(/^[a-z0-9._-]{3,50}$/).message('username must be 3-50 characters: letters, digits, dot, dash or underscore'),
  title: text(20),
  firstName: Joi.string().trim().max(100),
  middleName: text(100),
  lastName: text(100),
  gender: Joi.string().valid(...GENDERS).allow(null, ''),
  dateOfBirth: dateOnly.allow(null),
  estimatedAgeYears: Joi.number().integer().min(0).max(130).allow(null),
  preferredLanguage: text(40),

  phoneCountryCode: Joi.string().trim().pattern(/^\+?\d{1,4}$/),
  phoneNumber: phone,
  alternatePhoneNumber: phone.allow('', null),
  email: Joi.string().trim().email().max(255).allow('', null),

  addressLine1: text(255),
  addressLine2: text(255),
  countryId: positiveId.allow(null),
  stateId: positiveId.allow(null),
  districtId: positiveId.allow(null),
  subDistrictId: positiveId.allow(null),
  cityId: positiveId.allow(null),
  postalCodeId: positiveId.allow(null),

  emergencyContactName: text(150),
  emergencyContactRelationship: text(50),
  emergencyContactPhone: phone.allow('', null),

  guardianPatientId: positiveId.allow(null),
  guardianRelationship: text(50),

  abhaNumber: Joi.string().trim().pattern(/^[0-9-]{14,17}$/).message('ABHA number must be 14 digits (dashes allowed)').allow('', null),
  abhaAddress: text(100),
  idProofType: text(30),
  idProofLast4: Joi.string().trim().length(4).alphanum().allow('', null),

  notes: text(500),
};

const createSchema = Joi.object({
  ...fields,
  // The three mandatory fields at registration, plus the registering facility
  // (the patient number is issued by it).
  username: fields.username.required(),
  firstName: fields.firstName.required(),
  phoneNumber: fields.phoneNumber.required(),
  registrationFacilityId: positiveId.required(),
  // A family member sharing a phone number is legitimate: staff can confirm
  // after seeing the duplicate warning.
  allowDuplicate: Joi.boolean().default(false),
});

const updateSchema = Joi.object(fields).min(1);

const statusSchema = Joi.object({ status: Joi.string().valid(...STATUSES).required() });

// POST body, not query string: names and phone numbers stay out of URLs and logs.
const searchSchema = Joi.object({
  q: Joi.string().trim().max(100).allow('').default(''),
  status: Joi.string().valid(...ALL_STATUSES, '').default(''),
  facilityId: positiveId.optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const usernameCheckSchema = Joi.object({ username: fields.username.required(), excludePatientId: positiveId.optional() });

const facilityNumberSchema = Joi.object({ facilityId: positiveId.required() });

const mergeSchema = Joi.object({
  sourcePatientId: positiveId.required(),
  reason: text(300),
});

const settingsSchema = Joi.object({ retentionMonths: Joi.number().integer().min(1).max(120).required() });

const auditQuerySchema = paginationQuerySchema({});
const idParam = Joi.object({ id: positiveId.required() });
const uuidParam = Joi.object({ uuid: Joi.string().guid().required() });

module.exports = {
  GENDERS,
  STATUSES,
  ALL_STATUSES,
  createSchema,
  updateSchema,
  statusSchema,
  searchSchema,
  usernameCheckSchema,
  facilityNumberSchema,
  mergeSchema,
  settingsSchema,
  auditQuerySchema,
  idParam,
  uuidParam,
};
