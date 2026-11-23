import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './components/ui/Toast';
import { AuthProvider } from './context/AuthContext';
import { PwaProvider } from './context/PwaContext';
import { KeyboardShortcutProvider } from './context/KeyboardShortcutContext';
import { PwaInstallModal } from './components/pwa/PwaInstallModal';
import { Layout } from './components/layout/Layout';

// Code-split pages for lightning-fast initial load (< 200KB initial chunk)
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const BillsPage = lazy(() => import('./pages/BillsPage').then((m) => ({ default: m.BillsPage })));
const NewBillPage = lazy(() => import('./pages/NewBillPage').then((m) => ({ default: m.NewBillPage })));
const JobsPage = lazy(() => import('./pages/JobsPage').then((m) => ({ default: m.JobsPage })));
const MoneyPage = lazy(() => import('./pages/MoneyPage').then((m) => ({ default: m.MoneyPage })));
const MorePage = lazy(() => import('./pages/MorePage').then((m) => ({ default: m.MorePage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./pages/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const CustomersPage = lazy(() => import('./pages/CustomersPage').then((m) => ({ default: m.CustomersPage })));
const ServicesPage = lazy(() => import('./pages/ServicesPage').then((m) => ({ default: m.ServicesPage })));
const StaffCommissionPage = lazy(() => import('./pages/StaffCommissionPage').then((m) => ({ default: m.StaffCommissionPage })));
const StaffDetailPage = lazy(() => import('./pages/StaffDetailPage').then((m) => ({ default: m.StaffDetailPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const RecentlyDeletedPage = lazy(() => import('./pages/RecentlyDeletedPage').then((m) => ({ default: m.RecentlyDeletedPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const PublicDocumentViewPage = lazy(() => import('./pages/PublicDocumentViewPage').then((m) => ({ default: m.PublicDocumentViewPage })));
const KitPage = lazy(() => import('./pages/KitPage').then((m) => ({ default: m.KitPage })));

const PageLoadingFallback: React.FC = () => (
  <div className="flex-1 flex items-center justify-center p-8 select-none min-h-[300px]">
    <div className="flex flex-col items-center gap-3">
      <div className="w-6 h-6 border-2 border-[#0F766E]/20 border-t-[#0F766E] rounded-full animate-spin" />
      <span className="text-xs font-medium text-slate-400">Loading...</span>
    </div>
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 minutes
      retry: 1,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PwaProvider>
          <ToastProvider>
            <BrowserRouter>
              <KeyboardShortcutProvider>
                <Suspense fallback={<PageLoadingFallback />}>
                  <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route path="/view/document" element={<PublicDocumentViewPage />} />

                    <Route path="/" element={<Layout />}>
                      <Route index element={<DashboardPage />} />
                      <Route path="dashboard" element={<DashboardPage />} />
                      <Route path="bills" element={<BillsPage />} />
                      <Route path="bills/new" element={<NewBillPage />} />
                      <Route path="bills/:id/edit" element={<NewBillPage />} />
                      <Route path="jobs" element={<JobsPage />} />
                      <Route path="money" element={<MoneyPage />} />
                      <Route path="more" element={<MorePage />} />
                      <Route path="customers" element={<CustomersPage />} />
                      <Route path="services" element={<ServicesPage />} />
                      <Route path="staff" element={<StaffCommissionPage />} />
                      <Route path="earnings" element={<StaffCommissionPage />} />
                      <Route path="staff/:id" element={<StaffDetailPage />} />
                      <Route path="reports" element={<ReportsPage />} />
                      <Route path="settings" element={<SettingsPage />} />
                      <Route path="recently-deleted" element={<RecentlyDeletedPage />} />
                      <Route path="profile" element={<ProfilePage />} />
                      <Route path="_kit" element={<KitPage />} />
                    </Route>

                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Suspense>
                <PwaInstallModal />
              </KeyboardShortcutProvider>
            </BrowserRouter>
          </ToastProvider>
        </PwaProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
