const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const leadController = require('../controllers/leadController');

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

router.get('/queue/stats', leadController.getBroadcastStats);
router.post('/upload/:tenantId', upload.single('file'), leadController.uploadLeadsAndBroadcast);
router.get('/:tenantId', leadController.getLeadsByTenant);
module.exports = router;