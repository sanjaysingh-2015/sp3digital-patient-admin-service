const express = require('express');
const router = express.Router();

const controller = require('../controllers/patientController');
const { validate } = require('../middleware/validate');
const { authorize } = require('../middleware/authentication');
const { PATIENT_PERMISSIONS: P } = require('../utils/permissions');
const v = require('../validations/patient.validation');

// Paths are relative to /api/v1/patient-admin (see app.js). Each action is its own permission.

/**
 * @openapi
 * /patients:
 *   post:
 *     tags: [Patients]
 *     summary: Register a patient
 *     description: >
 *       Mandatory: username, firstName, phoneNumber and registrationFacilityId (the facility issues the patient number,
 *       e.g. FAC-000123). A patient under the minor age (18 by default) needs guardianPatientId — the guardian must be a
 *       registered adult patient. If a patient with the same phone and a similar name (or the same date of birth) already
 *       exists the call answers 409 DUPLICATE_CANDIDATES with the candidates; repeat with allowDuplicate=true to confirm
 *       it is a different person (a family sharing one phone is legitimate).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/PatientCreateRequest' }
 *     responses:
 *       201: { description: Patient registered (full detail) }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       409: { description: Username taken, or possible duplicate patients }
 */
router.post('/', authorize(P.CREATE), validate(v.createSchema), controller.create);

/**
 * @openapi
 * /patients/search:
 *   post:
 *     tags: [Patients]
 *     summary: Search patients (masked results)
 *     description: A POST so names and phone numbers never appear in URLs or access logs. Phone numbers come back masked.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               q: { type: string, description: 'Name, username, patient number or part of a phone number' }
 *               status: { type: string }
 *               facilityId: { type: integer }
 *               page: { type: integer }
 *               limit: { type: integer }
 *     responses:
 *       200: { description: 'Paginated patients ({ data, pagination })' }
 * /patients/username-check:
 *   post:
 *     tags: [Patients]
 *     summary: Is a username free in this tenant?
 *     responses:
 *       200: { description: '{ username, available }' }
 */
router.post('/search', authorize(P.READ), validate(v.searchSchema), controller.search);
router.post('/username-check', authorize(P.READ), validate(v.usernameCheckSchema), controller.usernameCheck);

/**
 * @openapi
 * /patients/by-uuid/{uuid}:
 *   get:
 *     tags: [Patients]
 *     summary: Look a patient up by uuid (for the appointment service)
 *     description: Returns the name, phone and email an appointment snapshots at booking time. Written to the access log as LOOKUP.
 *     parameters:
 *       - { name: uuid, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Patient snapshot fields }
 *       404: { description: Not found in this tenant }
 */
router.get('/by-uuid/:uuid', authorize(P.READ), validate(v.uuidParam, 'params'), controller.getByUuid);

/**
 * @openapi
 * /patients/{id}:
 *   get:
 *     tags: [Patients]
 *     summary: Full patient record (written to the access log)
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Patient detail with guardian and facility numbers }
 *   patch:
 *     tags: [Patients]
 *     summary: Edit a patient (the access log records which fields changed, not their values)
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Updated patient }
 */
router.get('/:id', authorize(P.READ), validate(v.idParam, 'params'), controller.getById);
router.patch('/:id', authorize(P.UPDATE), validate(v.idParam, 'params'), validate(v.updateSchema), controller.update);

/**
 * @openapi
 * /patients/{id}/status:
 *   patch:
 *     tags: [Patients]
 *     summary: Set ACTIVE / INACTIVE / DELETED (soft). INACTIVE and DELETED start the retention clock.
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Updated patient }
 * /patients/{id}/facility-numbers:
 *   post:
 *     tags: [Patients]
 *     summary: Issue the patient's number at another facility (idempotent)
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Patient detail including all facility numbers }
 * /patients/{id}/merge:
 *   post:
 *     tags: [Patients]
 *     summary: Merge a duplicate (sourcePatientId) into this patient
 *     description: The duplicate becomes MERGED and points here; nothing is deleted. Needs the merge permission.
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: The surviving patient }
 * /patients/{id}/audit:
 *   get:
 *     tags: [Patients]
 *     summary: Access log of one patient
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *       - { $ref: '#/components/parameters/PageParam' }
 *       - { $ref: '#/components/parameters/LimitParam' }
 *     responses:
 *       200: { description: Paginated log entries }
 */
router.patch('/:id/status', authorize(P.UPDATE), validate(v.idParam, 'params'), validate(v.statusSchema), controller.setStatus);
router.post('/:id/facility-numbers', authorize(P.UPDATE), validate(v.idParam, 'params'), validate(v.facilityNumberSchema), controller.issueFacilityNumber);
router.post('/:id/merge', authorize(P.MERGE), validate(v.idParam, 'params'), validate(v.mergeSchema), controller.merge);
router.get('/:id/audit', authorize(P.AUDIT), validate(v.idParam, 'params'), validate(v.auditQuerySchema, 'query'), controller.audit);

module.exports = router;
