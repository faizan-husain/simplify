import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Tag, UserCheck, BarChart3, Settings, Trash2, LogOut } from 'lucide-react';
import { t } from '../i18n';
import { ListRow } from '../components/ui/ListRow';
import { Card } from '../components/ui/Card';
import { useAuth } from '../context/AuthContext';

export const MorePage: React.FC = () => {
  const navigate = useNavigate();
  const { business, member, signOut } = useAuth();

  const handleSignOut = async () => {
    if (window.confirm('Are you sure you want to log out?')) {
      await signOut();
      navigate('/login');
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-xl mx-auto space-y-4">
      {/* Business Header */}
      <div className="bg-white p-4 rounded-card border border-border shadow-soft flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-primary-light text-primary flex items-center justify-center font-bold text-xl">
          {business?.name ? business.name.charAt(0).toUpperCase() : 'S'}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-text truncate">{business?.name || 'SIMPLIFY'}</h2>
          <p className="text-xs text-text-muted truncate">
            {member?.name ? `${member.name} (${member.role})` : 'Logged in'}
          </p>
        </div>
      </div>

      {/* Main Settings & Modules List */}
      <Card className="p-2 space-y-0.5">
        <ListRow
          title={t('customers.title')}
          subtitle="Manage customer profiles, numbers and dues"
          leftContent={<Users className="w-5 h-5 text-primary" />}
          onClick={() => navigate('/customers')}
        />
        <ListRow
          title="Services & Job Types"
          subtitle="Manage services, rates, deadline days and commission"
          leftContent={<Tag className="w-5 h-5 text-primary" />}
          onClick={() => navigate('/services')}
        />
        <ListRow
          title={t('staff.title')}
          subtitle="Team members, roles and commissions"
          leftContent={<UserCheck className="w-5 h-5 text-primary" />}
          onClick={() => navigate('/staff')}
        />
        <ListRow
          title={t('reports.title')}
          subtitle="Profit & loss, dues, expenses and summaries"
          leftContent={<BarChart3 className="w-5 h-5 text-primary" />}
          onClick={() => navigate('/reports')}
        />
        <ListRow
          title={t('settings.title')}
          subtitle="Business profile, invoice prefix, UPI QR and privacy PIN"
          leftContent={<Settings className="w-5 h-5 text-primary" />}
          onClick={() => navigate('/settings')}
        />
        <ListRow
          title={t('settings.recently_deleted')}
          subtitle="View and restore soft-deleted records"
          leftContent={<Trash2 className="w-5 h-5 text-danger" />}
          onClick={() => navigate('/recently-deleted')}
        />
      </Card>

      <Card className="p-2">
        <ListRow
          title={t('auth.logout')}
          showChevron={false}
          leftContent={<LogOut className="w-5 h-5 text-danger" />}
          onClick={handleSignOut}
        />
      </Card>
    </div>
  );
};
