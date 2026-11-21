import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { isValidEmail } from '../lib/auth';
import { t, getErrorMessage } from '../i18n';
import { useAuth } from '../context/AuthContext';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { Mail, Lock, Sparkles, ArrowRight } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user, member, refreshProfile } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && member) {
      navigate('/', { replace: true });
    }
  }, [user, member, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = identifier.trim().toLowerCase();
    if (!trimmed) {
      setError('Please enter your email address');
      return;
    }

    if (!trimmed.includes('@') || !isValidEmail(trimmed)) {
      setError('Please enter a valid email address (e.g. name@domain.com)');
      return;
    }

    if (!password) {
      setError(t('auth.required'));
      return;
    }

    setLoading(true);
    try {
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      });

      if (signInError) {
        throw signInError;
      }

      showToast(t('common.success'), 'success');
      if (signInData?.user) {
        await refreshProfile();
      }
      navigate('/', { replace: true });
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
    <div className="min-h-screen flex items-center justify-center p-4 bg-page">
      <div className="w-full max-w-[420px] bg-white p-8 rounded-2xl border border-border shadow-card">
        {/* Header with Perfectly Centered Official Logo */}
        <div className="text-center mb-7">
          <div className="w-full flex items-center justify-center mb-4">
            <img
              src="/simplify-logo.png"
              alt="SIMPLIFY"
              className="h-11 sm:h-12 w-auto object-contain mx-auto select-none"
            />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">{t('auth.sign_in')}</h1>
          <p className="text-xs text-text-muted mt-1">{t('app.tagline')}</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email Address (Login ID)"
            type="email"
            inputMode="email"
            placeholder="owner@simplify.com"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            disabled={loading}
            leftIcon={<Mail className="w-4 h-4 text-text-muted" />}
          />

          <Input
            label={t('auth.password_label')}
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            leftIcon={<Lock className="w-4 h-4 text-text-muted" />}
          />

          {error && (
            <div className="text-xs text-danger bg-danger/10 border border-danger/20 p-2.5 rounded-lg font-medium">
              {error}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full mt-1"
            loading={loading}
          >
            <span>{t('auth.sign_in')}</span>
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        </form>

        {/* Demo Fast Fill Pill */}
        <div className="mt-5 p-3 rounded-xl bg-surface-2 border border-border text-xs">
          <div className="flex items-center gap-1.5 text-text-muted font-medium mb-1.5">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            <span>Demo Quick Logins:</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleQuickDemo('owner@simplify.com')}
              className="px-2.5 py-1 rounded-lg bg-white border border-border text-accent font-medium hover:border-accent transition-colors cursor-pointer"
            >
              Owner Demo
            </button>
            <button
              type="button"
              onClick={() => handleQuickDemo('staff@simplify.com')}
              className="px-2.5 py-1 rounded-lg bg-white border border-border text-text font-medium hover:border-border transition-colors cursor-pointer"
            >
              Staff Demo
            </button>
          </div>
        </div>

        {/* Footer Link */}
        <div className="mt-6 text-center text-xs text-text-muted font-medium">
          Don't have an account?{' '}
          <Link to="/register" className="text-accent font-medium hover:underline">
            {t('auth.register')}
          </Link>
        </div>
      </div>
    </div>
  );
};
