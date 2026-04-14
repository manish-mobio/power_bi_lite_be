import express from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  handleSignup,
  handleLogin,
  handleLogout,
  handleMe,
  handleChangePassword,
} from '../controller/auth.controller.js';
import { handleValidationErrors } from '../middleware/validation.middleware.js';
import {
  signupValidation,
  loginValidation,
  changePasswordValidation,
} from '../middleware/validation.middleware.js';
const router = express.Router();
router.post('/signup', signupValidation, handleValidationErrors, handleSignup);
router.post('/login', loginValidation, handleValidationErrors, handleLogin);
router.post('/logout', handleLogout);
router.get('/me', requireAuth, handleMe);
router.post(
  '/change-password',
  requireAuth,
  changePasswordValidation,
  handleValidationErrors,
  handleChangePassword
);

export default router;
