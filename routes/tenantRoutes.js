const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenantController');
const { validate, tenantValidationRules } = require('../middleware/validate');
const { requireAdmin, requireTenantAccess } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

router.get('/me', tenantController.whoAmI);
router.post('/', requireAdmin, tenantValidationRules(), validate, tenantController.createTenant);
router.get('/', asyncHandler(tenantController.getAllTenants));
router.get('/:id', requireTenantAccess('id'), asyncHandler(tenantController.getTenantById));
router.post('/:id/rotate-key', requireAdmin, asyncHandler(tenantController.rotateApiKey));
module.exports = router;
