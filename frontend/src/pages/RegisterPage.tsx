import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { mobileToEmail, isValidIndianMobile } from '../lib/auth';
import { t, getErrorMessage } from '../i18n';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../context/AuthContext';

export const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { refreshProfile } = useAuth();

  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const email = mobileToEmail(mobile);

      // 1. Sign up auth user
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) {
        throw signUpError;
      }

      // If already signed in or newly created, invoke register_business RPC
      if (authData.session || authData.user) {
        const { error: rpcError } = await supabase.rpc('register_business', {
          business_name: businessName,
          owner_name: ownerName,
          mobile: mobile,
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
    <div className="min-h-screen flex items-center justify-center p-4 bg-surface">
      <div className="w-full max-w-sm bg-white p-6 rounded-card border border-border shadow-soft">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center text-white font-bold text-2xl mx-auto mb-3">
            S
          </div>
          <h1 className="text-xl font-bold tracking-tight text-text">{t('auth.sign_up')}</h1>
          <p className="text-xs text-text-muted mt-1">{t('app.tagline')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <Input
            label={t('auth.business_name_label')}
            placeholder="e.g. Sharma Xerox & Services"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            disabled={loading}
          />

          <Input
            label={t('auth.owner_name_label')}
            placeholder="e.g. Ramesh Sharma"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            disabled={loading}
          />

          <Input
            label={t('auth.mobile_label')}
            type="tel"
            inputMode="tel"
            placeholder={t('auth.mobile_placeholder')}
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            disabled={loading}
          />

          <Input
            label={t('auth.password_label')}
            type="password"
            placeholder="Min 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />

          {error && <div className="text-xs text-danger font-medium">{error}</div>}

          <Button type="submit" variant="primary" size="md" className="w-full mt-2" loading={loading}>
            {t('auth.sign_up')}
          </Button>
        </form>

        <div className="mt-6 text-center text-xs text-text-muted">
          Already have an account?{' '}
          <Link to="/login" className="text-primary font-semibold hover:underline">
            {t('auth.login')}
          </Link>
        </div>
      </div>
    </div>
  );
};
