import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { isValidEmail, isValidIndianMobile, mobileToEmail } from '../lib/auth';
import { t, getErrorMessage } from '../i18n';
import { useAuth } from '../context/AuthContext';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { Mail, Lock, Sparkles, ArrowRight } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = identifier.trim();
    if (!trimmed) {
      setError(t('auth.required'));
      return;
    }

    if (!password) {
      setError(t('auth.required'));
      return;
    }

    let authEmail = trimmed.toLowerCase();
    if (trimmed.includes('@')) {
      if (!isValidEmail(trimmed)) {
        setError(t('auth.invalid_email'));
        return;
      }
    } else if (isValidIndianMobile(trimmed)) {
      authEmail = mobileToEmail(trimmed);
    } else {
      setError(t('auth.invalid_email'));
      return;
    }

    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password,
      });

      if (signInError) {
        throw signInError;
      }

      showToast(t('common.success'), 'success');
      navigate('/');
    } catch (err: any) {
      setError(getErrorMessage(err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemo = (demoEmail: string) => {
    setIdentifier(demoEmail);
    setPassword('password123');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#F8FAFC]">
      <div className="w-full max-w-[420px] bg-white p-8 rounded-2xl border border-slate-200/80 shadow-[0_10px_35px_-5px_rgba(8,98,236,0.08)]">
        {/* Header */}
        <div className="text-center mb-7">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-b from-[#0B67F6] to-[#073897] text-white flex items-center justify-center font-bold text-2xl mx-auto mb-3.5 shadow-md shadow-[#0862EC]/20">
            S
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">{t('auth.sign_in')}</h1>
          <p className="text-xs font-medium text-slate-500 mt-1">{t('app.tagline')}</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t('auth.email_label')}
            type="email"
            inputMode="email"
            placeholder="owner@simplify.com"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            disabled={loading}
            leftIcon={<Mail className="w-4 h-4 text-slate-400" />}
          />

          <Input
            label={t('auth.password_label')}
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            leftIcon={<Lock className="w-4 h-4 text-slate-400" />}
          />

          {error && (
            <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 p-2.5 rounded-lg font-medium">
              {error}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full font-semibold bg-[#0862EC] hover:bg-[#0652CA] text-white shadow-md shadow-[#0862EC]/20 transition-all mt-1"
            loading={loading}
          >
            <span>{t('auth.sign_in')}</span>
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        </form>

        {/* Demo Fast Fill Pill */}
        <div className="mt-5 p-3 rounded-xl bg-slate-50 border border-slate-200/60 text-xs">
          <div className="flex items-center gap-1.5 text-slate-600 font-semibold mb-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#0862EC]" />
            <span>Demo Quick Logins:</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleQuickDemo('owner@simplify.com')}
              className="px-2.5 py-1 rounded-md bg-white border border-slate-200 text-[#0862EC] font-medium hover:border-[#0862EC] transition-colors"
            >
              Owner Demo
            </button>
            <button
              type="button"
              onClick={() => handleQuickDemo('staff@simplify.com')}
              className="px-2.5 py-1 rounded-md bg-white border border-slate-200 text-slate-700 font-medium hover:border-[#0862EC] transition-colors"
            >
              Staff Demo
            </button>
          </div>
        </div>

        {/* Footer Link */}
        <div className="mt-6 text-center text-xs text-slate-500 font-medium">
          Don't have an account?{' '}
          <Link to="/register" className="text-[#0862EC] font-semibold hover:underline">
            {t('auth.register')}
          </Link>
        </div>
      </div>
    </div>
  );
};
