import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, FileText, ExternalLink, AlertTriangle, Building } from 'lucide-react';

export const PublicDocumentViewPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const url = searchParams.get('url') || '';
  const docType = searchParams.get('type') || 'invoice';
  const docNum = searchParams.get('num') || '';
  const bizName = searchParams.get('biz') || 'SIMPLIFY Merchant';
  const amount = searchParams.get('amount') || '';
  const dueInfo = searchParams.get('due') || '';

  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }

    // Ping the URL with HEAD/GET to test if the signed link is active or expired (403)
    fetch(url, { method: 'HEAD' })
      .then((res) => {
        if (res.status === 403 || res.status === 401) {
          setExpired(true);
        }
      })
      .catch(() => {
        // In case of CORS on HEAD, we let iframe handle it
      })
      .finally(() => {
        setLoading(false);
      });
  }, [url]);

  const handleDownload = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${docType}-${docNum || 'document'}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const isInvoice = docType.toLowerCase().includes('invoice') || docType.toLowerCase().includes('bill');
  const title = isInvoice ? `Invoice #${docNum}` : `Payment Receipt #${docNum}`;

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-start p-4 sm:p-6 text-slate-800">
      {/* Top Header Card */}
      <div className="w-full max-w-2xl bg-white rounded-2xl border border-slate-200/80 shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-4 sm:p-5 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 text-[#0F766E] flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Building className="w-3 h-3" />
                  {bizName}
                </span>
              </div>
              <h1 className="text-base sm:text-lg font-bold text-slate-900 mt-0.5">
                {title}
              </h1>
            </div>
          </div>

          <div className="text-right">
            {amount && (
              <div className="text-lg sm:text-xl font-bold text-slate-900 tabular-nums">
                {amount}
              </div>
            )}
            {dueInfo && (
              <div className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded mt-0.5">
                {dueInfo}
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-3 mt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={handleDownload}
            disabled={loading || expired || !url}
            className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-[#0F766E] hover:bg-[#0D655E] text-white text-xs font-semibold shadow-xs transition-all cursor-pointer disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Download PDF
          </button>
          {url && !loading && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-all"
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              Open Fullscreen
            </a>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="w-full max-w-2xl flex-1 flex flex-col">
        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center shadow-xs flex flex-col items-center justify-center gap-3 select-none">
            <img
              src="/simplify-mark.png"
              alt="SIMPLIFY"
              className="w-12 h-12 object-contain select-none animate-pulse"
            />
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="w-2 h-2 rounded-full bg-[#0F766E] animate-bounce [animation-delay:-0.3s]" />
              <div className="w-2 h-2 rounded-full bg-[#0F766E] animate-bounce [animation-delay:-0.15s]" />
              <div className="w-2 h-2 rounded-full bg-[#0F766E] animate-bounce" />
            </div>
            <p className="text-xs text-slate-500 font-medium mt-1">Loading document preview...</p>
          </div>
        ) : expired ? (
          <div className="bg-white rounded-2xl border border-rose-200 p-8 text-center shadow-xs">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-3">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-1">Document Link Expired</h2>
            <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
              This secure PDF link has expired for security reasons. Please contact{' '}
              <strong className="text-slate-700">{bizName}</strong> to request an updated copy.
            </p>
          </div>
        ) : !url ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-xs">
            <p className="text-sm text-slate-500">No document URL provided.</p>
          </div>
        ) : (
          <div className="w-full flex-1 bg-white rounded-2xl border border-slate-200 shadow-[0_4px_20px_rgba(0,0,0,0.04)] overflow-hidden min-h-[520px] flex flex-col">
            <iframe
              src={url}
              title={title}
              className="w-full flex-1 min-h-[520px] border-none"
            />
          </div>
        )}

        <div className="text-center py-4 text-xs text-slate-400">
          Powered by SIMPLIFY SaaS • Secure Document Delivery
        </div>
      </div>
    </div>
  );
};
