const express = require('express');
const router = express.Router();
const upload = require('../middleware/uploadPdf');
const uploadController = require('../controllers/uploadController');
const { requireTenantAccess } = require('../middleware/auth');
router.post('/brochure/:tenantId', requireTenantAccess(), upload.single('file'), uploadController.uploadBrochure);
module.exports = router;
