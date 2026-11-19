const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenantController');
const { validate, tenantValidationRules } = require('../middleware/validate');
router.post('/', tenantValidationRules(), validate, tenantController.createTenant);
router.get('/', tenantController.getAllTenants);
router.get('/:id', tenantController.getTenantById);
module.exports = router;