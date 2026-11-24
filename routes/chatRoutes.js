const express = require('express');
const router = express.Router();
const chat = require('../controllers/chatController');
const { requireTenantAccess } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const phoneOk = (req, res, next) => (/^\d{6,15}$/.test(req.params.phone) ? next() : res.status(400).json({ success: false, error: 'Invalid phone' }));
const tenantOk = (req, res, next) => (/^[a-f0-9]{24}$/i.test(req.params.tenantId) ? next() : res.status(400).json({ success: false, error: 'Invalid tenant id' }));

router.get('/:tenantId', tenantOk, requireTenantAccess(), asyncHandler(chat.listChats));
router.get('/:tenantId/:phone/messages', tenantOk, phoneOk, requireTenantAccess(), asyncHandler(chat.getMessages));
router.post('/:tenantId/:phone/messages', tenantOk, phoneOk, requireTenantAccess(), asyncHandler(chat.sendMessage));
router.post('/:tenantId/:phone/read', tenantOk, phoneOk, requireTenantAccess(), asyncHandler(chat.markRead));
router.patch('/:tenantId/:phone', tenantOk, phoneOk, requireTenantAccess(), asyncHandler(chat.updateChat));

module.exports = router;
