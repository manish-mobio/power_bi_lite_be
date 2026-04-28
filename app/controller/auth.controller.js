import { clearAuthCookie, setAuthCookie } from '../middleware/auth.middleware.js';
import { normalizeEmail, RESET_TOKEN_TTL_MINUTES } from '../utils/common.utils.js';
import bcrypt from 'bcryptjs';
import HTTP_STATUS from '../utils/statuscode.js';
import constants from '../utils/constant.utils.js';
import authServices from '../services/auth.services.js';
import { sendResetPasswordMail } from '../utils/share-dashboard-email.utils.js';

async function handleSignup(req, res, next) {
  try {
    const { email, password, name } = req.body || {};
    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail)
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: constants.EMAIL_IS_REQUIRED });
    if (!password || String(password).length < 8) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: constants.INVALID_PASSWORD_LENGTH });
    }

    const existing = await authServices.findOneAuthUser({ email: cleanEmail });
    if (existing)
      return res.status(HTTP_STATUS.CONFLICT).json({ error: constants.USER_ALREADY_EXISTS });

    const passwordHash = await bcrypt.hash(String(password), 12);
    const user = await authServices.createAuthUser({
      email: cleanEmail,
      passwordHash,
      name: typeof name === 'string' ? name.trim() : '',
    });

    return res
      .status(HTTP_STATUS.CREATED)
      .json({ id: user._id, email: user.email, name: user.name });
  } catch (error) {
    if (error?.code === 11000)
      return res.status(HTTP_STATUS.CONFLICT).json({ error: constants.USER_ALREADY_EXISTS });
    next(error);
  }
}

async function handleLogin(req, res, next) {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail || !password) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ error: constants.EMAIL_AND_PASSWORD_REQUIRED });
    }
    // service file for db queries
    const user = await authServices.findOneAuthUser({ email: cleanEmail });
    if (!user)
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: constants.INVALID_CREDENTIALS });

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok)
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: constants.INVALID_CREDENTIALS });

    const token = authServices.generateToken({ sub: String(user._id), email: user.email });

    setAuthCookie(res, token);
    return res.status(HTTP_STATUS.OK).json({ id: user._id, email: user.email, name: user.name });
  } catch (error) {
    next(error);
  }
}

async function handleMe(req, res) {
  try {
    const user = await authServices.findAuthUserById(req.user.id);
    if (!user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: constants.UNAUTHORIZED });
    return res
      .status(HTTP_STATUS.OK)
      .json({ id: user._id, email: user.email, name: user.name || '' });
  } catch {
    return res.status(HTTP_STATUS.OK).json({ id: req.user.id, email: req.user.email, name: '' });
  }
}

async function handleLogout(req, res) {
  clearAuthCookie(res);
  return res.status(HTTP_STATUS.OK).json({ ok: true });
}

async function handleChangePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ error: constants.CURRENT_AND_NEW_PASSWORD_REQUIRED });
    }
    if (String(currentPassword) === String(newPassword)) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ error: constants.CURRENT_AND_NEW_PASSWORD_MUST_BE_DIFFERENT });
    }
    if (String(newPassword).length < 8) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: constants.INVALID_PASSWORD_LENGTH });
    }

    const user = await authServices.findAuthUserByIdForUpdate(req.user.id);
    if (!user) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: constants.UNAUTHORIZED });

    const match = await bcrypt.compare(String(currentPassword), user.passwordHash);
    if (!match) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ error: constants.CURRENT_PASSWORD_INCORRECT });
    }

    user.passwordHash = await bcrypt.hash(String(newPassword), 12);
    await user.save();
    return res.status(HTTP_STATUS.OK).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

async function handleForgotPassword(req, res, next) {
  try {
    const cleanEmail = normalizeEmail(req.body?.email);
    if (!cleanEmail) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: constants.EMAIL_REQUIRED });
    }

    const user = await authServices.findOneAuthUser({ email: cleanEmail });
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: constants.USER_NOT_FOUND });
    }

    const resetToken = authServices.generatePasswordResetToken();
    const hashedToken = authServices.hashPasswordResetToken(resetToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

    await authServices.setPasswordResetToken({
      userId: user._id,
      hashedToken,
      expiresAt,
    });
    const resetLink = `${process.env.FRONTEND_BASE_URL}/reset-password/${resetToken}`;
    await sendResetPasswordMail(cleanEmail, resetLink);

    return res.status(HTTP_STATUS.OK).json({ message: constants.RESET_LINK_SENT });
  } catch (error) {
    next(error);
  }
}

async function handleResetPassword(req, res, next) {
  try {
    const token = String(req.params?.token || '').trim();
    const newPassword = String(req.body?.password || '');
    if (!token) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: constants.RESET_TOKEN_REQUIRED });
    }
    if (newPassword.length < 8) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: constants.INVALID_PASSWORD_LENGTH });
    }

    const hashedToken = authServices.hashPasswordResetToken(token);
    const user = await authServices.findAuthUserByResetToken(hashedToken);

    if (!user) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ error: constants.INVALID_OR_EXPIRED_RESET_TOKEN });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.resetPasswordToken = null;
    user.resetPasswordExpire = null;
    await user.save();

    return res.status(HTTP_STATUS.OK).json({ message: constants.PASSWORD_RESET_SUCCESS });
  } catch (error) {
    next(error);
  }
}

export {
  handleSignup,
  handleLogin,
  handleMe,
  handleLogout,
  handleChangePassword,
  handleForgotPassword,
  handleResetPassword,
};
