import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { isValidEmail, isValidIndianMobile } from '../lib/auth';
import { t, getErrorMessage } from '../i18n';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../context/AuthContext';
import { Building2, User, Mail, Phone, Lock, ArrowRight } from 'lucide-react';

export const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user, refreshProfile } = useAuth();

  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
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

    if (!businessName.trim()) {
      setError(t('auth.required'));
      return;
    }
    if (!ownerName.trim()) {
      setError(t('auth.required'));
      return;
    }
    if (!isValidEmail(email)) {
      setError(t('auth.invalid_email'));
      return;
    }
    if (!isValidIndianMobile(mobile)) {
      setError(t('auth.invalid_mobile'));
      return;
    }
    if (!password || password.length < 8) {
      setError(t('auth.password_min'));
      return;
    }

    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();

      // 1. Sign up auth user directly with real Email ID
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
      });

      if (signUpError) {
        throw signUpError;
      }

      // If already signed in or newly created, invoke register_business RPC
      if (authData.session || authData.user) {
        const { error: rpcError } = await supabase.rpc('register_business', {
          business_name: businessName.trim(),
          owner_name: ownerName.trim(),
          mobile: mobile.trim(),
        });

        if (rpcError) {
          throw rpcError;
        }

        await refreshProfile();
        showToast(t('common.success'), 'success');
        navigate('/');
      }
    } catch (err: any) {
      setError(getErrorMessage(err.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-page">
      <div className="w-full max-w-[440px] bg-white p-8 rounded-2xl border border-border shadow-card">
        {/* Header with Perfectly Centered Official Logo */}
        <div className="text-center mb-6">
          <div className="w-full flex items-center justify-center mb-3.5">
            <img
              src="/simplify-logo.png"
              alt="SIMPLIFY"
              className="h-11 sm:h-12 w-auto object-contain mx-auto select-none"
            />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">{t('auth.sign_up')}</h1>
          <p className="text-xs text-text-muted mt-1">{t('app.tagline')}</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <Input
            label={t('auth.business_name_label')}
            placeholder="e.g. Apex Digital & Doc Center"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            disabled={loading}
            leftIcon={<Building2 className="w-4 h-4 text-text-muted" />}
          />

          <Input
            label={t('auth.owner_name_label')}
            placeholder="e.g. Ramesh Sharma"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            disabled={loading}
            leftIcon={<User className="w-4 h-4 text-text-muted" />}
          />

          <Input
            label={t('auth.email_label')}
            type="email"
            inputMode="email"
            placeholder="owner@business.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            leftIcon={<Mail className="w-4 h-4 text-text-muted" />}
          />

          <Input
            label={t('auth.mobile_label')}
            type="tel"
            inputMode="tel"
            placeholder={t('auth.mobile_placeholder')}
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            disabled={loading}
            leftIcon={<Phone className="w-4 h-4 text-text-muted" />}
          />

          <Input
            label={t('auth.password_label')}
            type="password"
            placeholder="Min 8 characters"
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
            className="w-full mt-2"
            loading={loading}
          >
            <span>{t('auth.sign_up')}</span>
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        </form>

        <div className="mt-6 text-center text-xs text-text-muted font-medium">
          Already have an account?{' '}
          <Link to="/login" className="text-accent font-medium hover:underline">
            {t('auth.login')}
          </Link>
        </div>
      </div>
    </div>
  );
};
