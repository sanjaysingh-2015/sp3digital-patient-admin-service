const patientService = require('../services/patientService');
const settingsService = require('../services/settingsService');

const ctxOf = (req) => ({ tenantUuid: req.auth.tenantUuid, userId: req.auth.userId, token: req.auth.rawToken });

// Thin wrappers only — every rule lives in the services.
const handle = (fn) => async (req, res, next) => {
  try {
    const { status, body } = await fn(req);
    return res.status(status).json(body);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  create: handle(async (req) => ({ status: 201, body: await patientService.create(req.body, ctxOf(req)) })),
  search: handle(async (req) => ({ status: 200, body: await patientService.search(req.body, ctxOf(req)) })),
  usernameCheck: handle(async (req) => ({ status: 200, body: await patientService.usernameAvailable(req.body, ctxOf(req)) })),
  getById: handle(async (req) => ({ status: 200, body: await patientService.getById(req.params.id, ctxOf(req)) })),
  getByUuid: handle(async (req) => ({ status: 200, body: await patientService.getByUuid(req.params.uuid, ctxOf(req)) })),
  update: handle(async (req) => ({ status: 200, body: await patientService.update(req.params.id, req.body, ctxOf(req)) })),
  setStatus: handle(async (req) => ({ status: 200, body: await patientService.setStatus(req.params.id, req.body.status, ctxOf(req)) })),
  issueFacilityNumber: handle(async (req) => ({ status: 200, body: await patientService.issueFacilityNumber(req.params.id, req.body.facilityId, ctxOf(req)) })),
  merge: handle(async (req) => ({ status: 200, body: await patientService.merge(req.params.id, req.body, ctxOf(req)) })),
  audit: handle(async (req) => ({ status: 200, body: await patientService.listAudit(req.params.id, req.query, ctxOf(req)) })),
  getSettings: handle(async (req) => ({ status: 200, body: await settingsService.get(req.auth.tenantUuid) })),
  updateSettings: handle(async (req) => ({ status: 200, body: await settingsService.update(req.auth.tenantUuid, req.body, ctxOf(req)) })),
};
