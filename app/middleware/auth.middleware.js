import jwt from 'jsonwebtoken';
import HTTP_STATUS from '../utils/statuscode.js';
import constants from '../utils/constant.utils.js';

export function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.access_token;
    if (!token) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: constants.UNAUTHORIZED });

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json({ error: constants.SERVER_AUTH_MISCONFIGURED });
    }

    const payload = jwt.verify(token, secret);
    if (!payload?.sub)
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: constants.UNAUTHORIZED });

    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch (err) {
    if (err?.name === 'TokenExpiredError') {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: constants.SESSION_EXPIRED });
    }
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: constants.UNAUTHORIZED });
  }
}

// set cookies conifiguratiuon for auth token
export function setAuthCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('access_token', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

export function clearAuthCookie(res) {
  res.clearCookie('access_token', { path: '/' });
}
