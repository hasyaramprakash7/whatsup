const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const leadController = require('../controllers/leadController');
const { requireAdmin, requireTenantAccess } = require('../middleware/auth');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.mimetype === 'application/vnd.ms-excel' || file.originalname.toLowerCase().endsWith('.csv')) {
      return cb(null, true);
    }
    cb(new Error('Only CSV files are allowed'));
  },
});

// Queue stats are global across tenants, so admin-only.
router.get('/queue/stats', requireAdmin, leadController.getBroadcastStats);
// Access check runs before multer so unauthorized uploads never touch disk.
router.post('/upload/:tenantId', requireTenantAccess(), upload.single('file'), leadController.uploadLeadsAndBroadcast);
router.get('/:tenantId/stats', requireTenantAccess(), leadController.getLeadStats);
router.get('/:tenantId', requireTenantAccess(), leadController.getLeadsByTenant);
module.exports = router;