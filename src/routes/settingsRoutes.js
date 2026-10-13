const express = require('express');
const router = express.Router();

const controller = require('../controllers/patientController');
const { validate } = require('../middleware/validate');
const { authorize } = require('../middleware/authentication');
const { PATIENT_PERMISSIONS: P } = require('../utils/permissions');
const v = require('../validations/patient.validation');

/**
 * @openapi
 * /settings:
 *   get:
 *     tags: [Settings]
 *     summary: Tenant patient settings (retention period)
 *     responses:
 *       200: { description: '{ retentionMonths, isDefault }' }
 *   put:
 *     tags: [Settings]
 *     summary: Set how many months inactive / deleted patients are kept before they are anonymized (default 6)
 *     responses:
 *       200: { description: Updated settings }
 */
router.get('/', authorize(P.READ), controller.getSettings);
router.put('/', authorize(P.SETTINGS), validate(v.settingsSchema), controller.updateSettings);

module.exports = router;
