require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');

const swaggerSpec = require('./config/swagger');
const db = require('./models');
const { authenticate } = require('./middleware/authentication');
const patientRoutes = require('./routes/patientRoutes');
const settingsRoutes = require('./routes/settingsRoutes');

const app = express();

// Swagger UI needs inline scripts/styles, so /docs gets a relaxed CSP and is
// registered before the strict global helmet() (same pattern as the other services).
app.use('/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'SP3 Digital — Patient Admin Service API Docs',
}));
app.get('/docs.json', (req, res) => res.json(swaggerSpec));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);

app.use(helmet());
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins, credentials: true } : undefined));
app.use(express.json({ limit: '1mb' }));

// Patient data: a tighter limit than the master-data services, to slow down scraping.
const apiRateLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false });

const basePath = '/api/v1/patient-admin';

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Liveness check
 *     security: []
 *     responses:
 *       200: { description: Service is up }
 */
app.get(`${basePath}/health`, (req, res) => res.status(200).json({ status: 'ok' }));

app.use(basePath, apiRateLimiter, authenticate);
app.use(`${basePath}/patients`, patientRoutes);
app.use(`${basePath}/settings`, settingsRoutes);

// Same error envelope as the other admin services. Error bodies never carry
// patient details, except the masked duplicate candidates the caller asked about.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.isJoi) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: error.details.map((d) => d.message) },
    });
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }

  if (!error.statusCode || error.statusCode >= 500) console.error(error.message);
  return res.status(error.statusCode || 500).json({
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.expose ? error.message : 'An unexpected error occurred',
      ...(error.expose && error.details ? { details: error.details } : {}),
      ...(error.expose && error.candidates ? { candidates: error.candidates } : {}),
    },
  });
});

const PORT = process.env.PORT || 3400;

async function startServer() {
  try {
    await db.sequelize.authenticate();
    console.log('Database connection established successfully.');
    app.listen(PORT, () => console.log(`sp3digital-patient-admin-service running on port ${PORT}`));
  } catch (error) {
    console.error('Unable to start patient-admin-service:', error.message);
  }
}

// Only auto-start when run directly; tests `require` the configured app.
if (require.main === module) startServer();

module.exports = app;
