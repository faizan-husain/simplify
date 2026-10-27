import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './components/ui/Toast';
import { AuthProvider } from './context/AuthContext';
import { Layout } from './components/layout/Layout';

// Pages
import { DashboardPage } from './pages/DashboardPage';
import { BillsPage } from './pages/BillsPage';
import { NewBillPage } from './pages/NewBillPage';
import { JobsPage } from './pages/JobsPage';
import { MoneyPage } from './pages/MoneyPage';
import { MorePage } from './pages/MorePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { CustomersPage } from './pages/CustomersPage';
import { ServicesPage } from './pages/ServicesPage';

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
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />

              <Route path="/" element={<Layout />}>
                <Route index element={<DashboardPage />} />
                <Route path="bills" element={<BillsPage />} />
                <Route path="bills/new" element={<NewBillPage />} />
                <Route path="jobs" element={<JobsPage />} />
                <Route path="money" element={<MoneyPage />} />
                <Route path="more" element={<MorePage />} />
                <Route path="customers" element={<CustomersPage />} />
                <Route path="services" element={<ServicesPage />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
