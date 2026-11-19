const { validationResult, body } = require('express-validator');
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  next();
};
const tenantValidationRules = () => [
  body('businessName').isString().trim().notEmpty(),
  body('phoneNumberId').isString().trim().notEmpty(),
  body('wabaId').isString().trim().notEmpty(),
  body('accessToken').isString().notEmpty(),
  body('adminNotificationPhone').isString().notEmpty(),
  body('projectDetails.projectName').isString().notEmpty(),
  body('projectDetails.brochurePdfUrl').optional({ nullable: true, checkFalsy: true }).isURL(),
  body('projectDetails.latitude').isFloat({ min: -90, max: 90 }),
  body('projectDetails.longitude').isFloat({ min: -180, max: 180 }),
  body('projectDetails.siteAddress').isString().notEmpty(),
];
module.exports = { validate, tenantValidationRules };