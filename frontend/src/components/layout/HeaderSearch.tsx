import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { Search, User, FileText, Receipt as ReceiptIcon, X } from 'lucide-react';

export const HeaderSearch: React.FC = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{
    customers: any[];
    invoices: any[];
    receipts: any[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      setOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('global_search', { q: query.trim() });
        if (!error && data) {
          setResults(data);
          setOpen(true);
        }
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectCustomer = () => {
    setOpen(false);
    setQuery('');
    navigate('/customers');
  };

  const handleSelectInvoice = () => {
    setOpen(false);
    setQuery('');
    navigate('/bills');
  };

  const handleSelectReceipt = () => {
    setOpen(false);
    setQuery('');
    navigate('/money');
  };

  const hasAnyResults =
    results &&
    (results.customers.length > 0 ||
      results.invoices.length > 0 ||
      results.receipts.length > 0);

  return (
    <div ref={dropdownRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (hasAnyResults) setOpen(true);
          }}
          placeholder="Search bills, customers, receipts..."
          className="w-full h-9 pl-9 pr-8 bg-surface rounded-lg text-sm text-text placeholder:text-text-muted border border-border focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setResults(null);
              setOpen(false);
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Results Dropdown */}
      {open && hasAnyResults && (
        <div className="absolute left-0 right-0 top-11 z-50 bg-white rounded-card border border-border shadow-lg max-h-96 overflow-y-auto p-2 space-y-3">
          {/* Customers */}
          {results.customers.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-text-muted uppercase px-2 py-1 tracking-wider">
                Customers
              </div>
              <div className="space-y-0.5">
                {results.customers.map((c) => (
                  <div
                    key={c.id}
                    onClick={handleSelectCustomer}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-surface cursor-pointer text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <User className="w-3.5 h-3.5 text-primary" />
                      <span className="font-semibold text-text">{c.name}</span>
                      {c.mobile && (
                        <span className="text-text-muted">({c.mobile})</span>
                      )}
                    </div>
                    <span className="text-[10px] text-text-muted uppercase">
                      {c.type}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Invoices */}
          {results.invoices.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-text-muted uppercase px-2 py-1 tracking-wider">
                Bills
              </div>
              <div className="space-y-0.5">
                {results.invoices.map((inv) => (
                  <div
                    key={inv.id}
                    onClick={handleSelectInvoice}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-surface cursor-pointer text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-primary" />
                      <span className="font-semibold text-text">{inv.number}</span>
                      <span className="text-text-muted">• {inv.party_name}</span>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-text">
                        {formatINR(inv.total)}
                      </span>
                      {inv.balance > 0 && (
                        <span className="text-[10px] text-danger ml-1.5">
                          Due {formatINR(inv.balance)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Receipts */}
          {results.receipts.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-text-muted uppercase px-2 py-1 tracking-wider">
                Receipts
              </div>
              <div className="space-y-0.5">
                {results.receipts.map((r) => (
                  <div
                    key={r.id}
                    onClick={handleSelectReceipt}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-surface cursor-pointer text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <ReceiptIcon className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="font-semibold text-text">{r.number}</span>
                      <span className="text-text-muted">
                        • {formatDate(r.receipt_date)} ({r.mode})
                      </span>
                    </div>
                    <span className="font-semibold text-emerald-600">
                      {formatINR(r.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {open && !loading && results && !hasAnyResults && (
        <div className="absolute left-0 right-0 top-11 z-50 bg-white rounded-card border border-border shadow-lg p-3 text-center text-xs text-text-muted">
          No matching customers, bills or receipts.
        </div>
      )}
    </div>
  );
};
