const express = require('express');
const router = express.Router();
const upload = require('../middleware/uploadPdf');
const uploadController = require('../controllers/uploadController');
router.post('/brochure/:tenantId', upload.single('file'), uploadController.uploadBrochure);
module.exports = router;