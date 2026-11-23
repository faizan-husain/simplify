import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

interface RealtimeSyncOptions {
  businessId?: string | null;
  enabled?: boolean;
}

/**
 * Enterprise-Grade Multi-Device Live Realtime Synchronization Hook
 *
 * Automatically keeps all connected devices (desktop, laptop, tablet, mobile)
 * synchronized with authoritative PostgreSQL changes without requiring manual refresh.
 */
export function useRealtimeSync({ businessId, enabled = true }: RealtimeSyncOptions) {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const debounceTimerRef = useRef<Record<string, NodeJS.Timeout>>({});

  // Debounced cache invalidator to prevent refetch storms during rapid multi-record operations
  const debouncedInvalidate = useCallback(
    (queryKey: string[], table?: string, delay = 300) => {
      const keyStr = queryKey.join(':');
      if (debounceTimerRef.current[keyStr]) {
        clearTimeout(debounceTimerRef.current[keyStr]);
      }
      debounceTimerRef.current[keyStr] = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey });
        // Dispatch window CustomEvent so active React components using local state re-fetch automatically
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('simplify:sync', {
              detail: { queryKey, table },
            })
          );
        }
        delete debounceTimerRef.current[keyStr];
      }, delay);
    },
    [queryClient]
  );

  useEffect(() => {
    if (!enabled || !businessId) {
      setIsConnected(false);
      return;
    }

    const channelName = `biz_sync:${businessId}`;
    const channel = supabase.channel(channelName);

    // 1. Invoices & Billing changes
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'invoices',
        filter: `business_id=eq.${businessId}`,
      },
      () => {
        debouncedInvalidate(['invoices'], 'invoices');
        debouncedInvalidate(['dashboard'], 'invoices');
        debouncedInvalidate(['dues'], 'invoices');
        debouncedInvalidate(['reports'], 'invoices');
      }
    );

    // 2. Receipts & Payments IN
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'receipts',
        filter: `business_id=eq.${businessId}`,
      },
      () => {
        debouncedInvalidate(['receipts'], 'receipts');
        debouncedInvalidate(['dues'], 'receipts');
        debouncedInvalidate(['cash_bank'], 'receipts');
        debouncedInvalidate(['dashboard'], 'receipts');
        debouncedInvalidate(['reports'], 'receipts');
      }
    );

    // 3. Customers & Ledgers
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'customers',
        filter: `business_id=eq.${businessId}`,
      },
      () => {
        debouncedInvalidate(['customers'], 'customers');
        debouncedInvalidate(['dues'], 'customers');
        debouncedInvalidate(['dashboard'], 'customers');
      }
    );

    // 4. Jobs & Service Steps
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'jobs',
        filter: `business_id=eq.${businessId}`,
      },
      () => {
        debouncedInvalidate(['jobs'], 'jobs');
        debouncedInvalidate(['dashboard'], 'jobs');
        debouncedInvalidate(['staff'], 'jobs');
      }
    );

    // 5. Expenses (Business Overhead)
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'expenses',
        filter: `business_id=eq.${businessId}`,
      },
      () => {
        debouncedInvalidate(['expenses'], 'expenses');
        debouncedInvalidate(['cash_bank'], 'expenses');
        debouncedInvalidate(['dashboard'], 'expenses');
        debouncedInvalidate(['reports'], 'expenses');
      }
    );

    // 6. Vendor Payments OUT
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'payments',
        filter: `business_id=eq.${businessId}`,
      },
      () => {
        debouncedInvalidate(['payments'], 'payments');
        debouncedInvalidate(['cash_bank'], 'payments');
        debouncedInvalidate(['dashboard'], 'payments');
        debouncedInvalidate(['reports'], 'payments');
      }
    );

    // 7. Money Transfers (Contra Cash <-> Bank)
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'money_transfers',
        filter: `business_id=eq.${businessId}`,
      },
      () => {
        debouncedInvalidate(['cash_bank'], 'money_transfers');
        debouncedInvalidate(['dashboard'], 'money_transfers');
      }
    );

    // 8. Staff Payouts & Commission
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'staff_payouts',
        filter: `business_id=eq.${businessId}`,
      },
      () => {
        debouncedInvalidate(['staff'], 'staff_payouts');
        debouncedInvalidate(['cash_bank'], 'staff_payouts');
      }
    );

    // Subscribe to channel with connection status handling
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setIsConnected(true);
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        setIsConnected(false);
      }
    });

    // Network recovery and window focus handler: ensure stale state is updated after reconnection
    const handleReconnection = () => {
      if (navigator.onLine) {
        debouncedInvalidate(['dashboard'], 'dashboard', 50);
        debouncedInvalidate(['invoices'], 'invoices', 50);
        debouncedInvalidate(['dues'], 'dues', 50);
        debouncedInvalidate(['receipts'], 'receipts', 50);
        debouncedInvalidate(['cash_bank'], 'cash_bank', 50);
      }
    };

    window.addEventListener('online', handleReconnection);
    window.addEventListener('focus', handleReconnection);

    return () => {
      window.removeEventListener('online', handleReconnection);
      window.removeEventListener('focus', handleReconnection);
      supabase.removeChannel(channel);

      // Clear any pending debounces on unmount
      Object.values(debounceTimerRef.current).forEach(clearTimeout);
      debounceTimerRef.current = {};
    };
  }, [businessId, enabled, debouncedInvalidate]);

  return { isConnected };
}
