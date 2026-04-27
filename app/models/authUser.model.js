import mongoose from 'mongoose';

const authUserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },
    name: { type: String, default: '' },
    resetPasswordToken: { type: String, default: null },
    resetPasswordExpire: { type: Date, default: null },
  },
  { timestamps: true }
);

const AuthUser = mongoose.models.AuthUser || mongoose.model('AuthUser', authUserSchema);
export default AuthUser;
