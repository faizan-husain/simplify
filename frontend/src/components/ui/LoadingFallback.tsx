import React from 'react';

/**
 * Inner viewport loading fallback for route transitions within the main layout.
 * Renders a crisp teal spinner centered in the viewport with a solid, seamless background.
 */
export const ContentLoadingFallback: React.FC = () => (
  <div className="flex-1 w-full min-h-[60vh] flex flex-col items-center justify-center p-8 select-none">
    <div className="flex flex-col items-center gap-3">
      <div className="w-7 h-7 border-[2.5px] border-[#0F766E]/20 border-t-[#0F766E] rounded-full animate-spin" />
      <span className="text-xs font-medium text-slate-400">Loading...</span>
    </div>
  </div>
);

/**
 * Fullscreen loading fallback for root-level navigation, auth verification, and initial chunk loads.
 * Covers the entire viewport with seamless #F6F7F9 background and centered spinner.
 */
export const PageLoadingFallback: React.FC = () => (
  <div className="fixed inset-0 z-50 flex h-screen w-screen items-center justify-center bg-[#F6F7F9] select-none">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-[2.5px] border-[#0F766E]/20 border-t-[#0F766E] rounded-full animate-spin" />
      <span className="text-xs font-medium text-slate-400">Loading...</span>
    </div>
  </div>
);
