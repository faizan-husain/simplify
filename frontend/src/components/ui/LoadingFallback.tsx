import React from 'react';

/**
 * Inner viewport loading fallback for route transitions within the main layout.
 * Displays the Simplify brand 'S' mark with gentle pulsing animation.
 */
export const ContentLoadingFallback: React.FC = () => (
  <div className="flex-1 w-full min-h-[50vh] flex flex-col items-center justify-center p-8 select-none">
    <div className="flex flex-col items-center gap-3.5">
      <div className="relative flex items-center justify-center">
        <img
          src="/simplify-mark.png"
          alt="SIMPLIFY"
          className="w-12 h-12 sm:w-14 sm:h-14 object-contain select-none animate-pulse"
        />
      </div>
      <div className="flex items-center gap-1.5 mt-0.5">
        <div className="w-2 h-2 rounded-full bg-[#0F766E] animate-bounce [animation-delay:-0.3s]" />
        <div className="w-2 h-2 rounded-full bg-[#0F766E] animate-bounce [animation-delay:-0.15s]" />
        <div className="w-2 h-2 rounded-full bg-[#0F766E] animate-bounce" />
      </div>
    </div>
  </div>
);

/**
 * Fullscreen loading fallback for root-level navigation, auth verification, and initial chunk loads.
 * Covers the entire viewport with seamless #F6F7F9 background and centered Simplify 'S' mark.
 */
export const PageLoadingFallback: React.FC = () => (
  <div className="fixed inset-0 z-50 flex h-screen w-screen items-center justify-center bg-[#F6F7F9] select-none">
    <div className="flex flex-col items-center gap-4">
      <div className="relative flex items-center justify-center">
        <img
          src="/simplify-mark.png"
          alt="SIMPLIFY"
          className="w-16 h-16 object-contain select-none animate-pulse"
        />
      </div>
      <div className="flex items-center gap-2 mt-1">
        <div className="w-2.5 h-2.5 rounded-full bg-[#0F766E] animate-bounce [animation-delay:-0.3s]" />
        <div className="w-2.5 h-2.5 rounded-full bg-[#0F766E] animate-bounce [animation-delay:-0.15s]" />
        <div className="w-2.5 h-2.5 rounded-full bg-[#0F766E] animate-bounce" />
      </div>
    </div>
  </div>
);
