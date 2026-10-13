/** Errors the global handler in app.js turns into { error: { code, message } }. */
function httpError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;
  if (details) error.details = details;
  return error;
}

module.exports = {
  httpError,
  patientNotFound: () => httpError(404, 'PATIENT_NOT_FOUND', 'Patient not found'),
};
