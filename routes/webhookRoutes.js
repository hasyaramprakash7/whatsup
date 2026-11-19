const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const verifyMetaSignature = require('../middleware/verifyMetaSignature');
router.get('/', webhookController.verifyWebhook);
router.post('/', verifyMetaSignature, webhookController.handleIncomingMessage);
module.exports = router;