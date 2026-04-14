import { validationResult, body } from 'express-validator';
import { param } from 'express-validator';
import HTTP_STATUS from '../utils/statuscode.js';
import constants from '../utils/constant.utils.js';

function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  return res.status(HTTP_STATUS.BAD_REQUEST).json({
    error: 'Validation failed',
    details: errors.array().map(err => ({
      field: err.path,
      message: err.msg,
      location: err.location,
    })),
  });
}

export const collectionParamValidation = [
  param('collection')
    .exists({ checkFalsy: true })
    .withMessage(constants.COLLECTION_NAME_REQUIRED)
    .bail()
    .isString()
    .withMessage(constants.COLLECTION_NAME_REQUIRED)
    .bail()
    .trim(),
];

export const signupValidation = [
  body('email')
    .exists({ checkFalsy: true })
    .withMessage(constants.EMAIL_IS_REQUIRED)
    .bail()
    .isEmail()
    .withMessage(constants.EMAIL_IS_REQUIRED)
    .bail()
    .trim()
    .toLowerCase(),
  body('password')
    .exists({ checkFalsy: true })
    .withMessage(constants.INVALID_PASSWORD_LENGTH)
    .bail()
    .isLength({ min: 8 })
    .withMessage(constants.INVALID_PASSWORD_LENGTH),
  body('name').optional().isString().trim(),
];

export const loginValidation = [
  body('email')
    .exists({ checkFalsy: true })
    .withMessage(constants.EMAIL_AND_PASSWORD_REQUIRED)
    .bail()
    .isEmail()
    .withMessage(constants.EMAIL_AND_PASSWORD_REQUIRED)
    .bail()
    .trim()
    .toLowerCase(),
  body('password').exists({ checkFalsy: true }).withMessage(constants.EMAIL_AND_PASSWORD_REQUIRED),
];

export const changePasswordValidation = [
  body('currentPassword')
    .exists({ checkFalsy: true })
    .withMessage(constants.CURRENT_AND_NEW_PASSWORD_REQUIRED),
  body('newPassword')
    .exists({ checkFalsy: true })
    .withMessage(constants.CURRENT_AND_NEW_PASSWORD_REQUIRED)
    .bail()
    .isLength({ min: 8 })
    .withMessage(constants.INVALID_PASSWORD_LENGTH),
  body('newPassword').custom((value, { req }) => {
    if (String(value) === String(req.body?.currentPassword)) {
      throw new Error(constants.CURRENT_AND_NEW_PASSWORD_MUST_BE_DIFFERENT);
    }
    return true;
  }),
];

export { handleValidationErrors };
