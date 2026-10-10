import React, { useState } from 'react';
import {
  Landmark,
  Lock,
  User,
  Eye,
  EyeOff,
  LogIn,
  AlertCircle
} from 'lucide-react';
import { AuthenticatedUser } from '../types';
import { setStoredAuthToken } from '../utils/matcher';

interface LoginPageProps {
  onLoginSuccess: (user: AuthenticatedUser, token: string) => void;
  initialError?: string | null;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, initialError }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialError || null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMessage('لطفاً نام کاربری و رمز عبور را وارد نمایید.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password
        })
      });

      const data = await response.json();
      if (!response.ok) {
        setErrorMessage(data.error || 'خطا در ورود به سامانه');
        setLoading(false);
        return;
      }

      setStoredAuthToken(data.token);
      onLoginSuccess(data.user, data.token);
    } catch {
      setErrorMessage('خطا در ارتباط با سرور');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Header section */}
        <div className="p-6 border-b border-slate-100 text-center space-y-2.5">
          <div className="w-12 h-12 rounded-xl bg-blue-700 text-white flex items-center justify-center mx-auto shadow-xs">
            <Landmark className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-extrabold text-slate-900">
            تطبیق هوشمند باروت کوب
          </h1>
        </div>

        {/* Form section */}
        <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-5" id="form-login">
          {errorMessage && (
            <div
              className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-start gap-2.5 leading-relaxed"
              id="login-error-alert"
            >
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700" htmlFor="input-login-username">
              نام کاربری
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="input-login-username"
                type="text"
                dir="ltr"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                className="w-full pr-10 pl-3.5 py-2.5 text-sm font-mono bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 text-slate-900 transition-all"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700" htmlFor="input-login-password">
              رمز عبور
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="input-login-password"
                type={showPassword ? 'text' : 'password'}
                dir="ltr"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pr-10 pl-10 py-2.5 text-sm font-mono bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 text-slate-900 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                title={showPassword ? 'مخفی کردن رمز' : 'نمایش رمز'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-3 px-5 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 transition-all shadow-xs ${
              loading
                ? 'bg-blue-400 cursor-not-allowed'
                : 'bg-blue-700 hover:bg-blue-800 active:scale-[0.99] cursor-pointer'
            }`}
            id="btn-login-submit"
          >
            <LogIn className="w-4 h-4" />
            <span>{loading ? 'در حال ورود...' : 'ورود به سامانه'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
