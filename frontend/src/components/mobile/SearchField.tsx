import React, { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface SearchFieldProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  debounceMs?: number;
  rightAction?: React.ReactNode;
}

export const SearchField: React.FC<SearchFieldProps> = ({
  value,
  onChange,
  placeholder = 'Search...',
  className,
  debounceMs = 250,
  rightAction,
}) => {
  const [localValue, setLocalValue] = useState(value);

  // Sync internal state with external value prop
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Debounced output
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localValue !== value) {
        onChange(localValue);
      }
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [localValue, debounceMs, onChange, value]);

  const handleClear = () => {
    setLocalValue('');
    onChange('');
  };

  return (
    <div
      className={twMerge(
        clsx(
          'relative flex items-center w-full h-[44px] bg-white rounded-xl shadow-2xs border border-border/70 overflow-hidden focus-within:border-accent transition-all',
          className
        )
      )}
    >
      <div className="pl-3.5 pr-2 flex items-center justify-center pointer-events-none text-text-muted shrink-0">
        <Search className="w-4 h-4" />
      </div>

      <input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder={placeholder}
        className="w-full h-full bg-transparent text-[16px] text-text placeholder:text-text-muted/70 font-normal outline-none pr-2"
        autoComplete="off"
        autoCorrect="off"
        spellCheck="false"
      />

      {localValue && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear search query"
          className="p-1.5 mr-2 rounded-lg text-text-muted hover:text-text hover:bg-surface-2 transition-colors shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {rightAction && (
        <div className="pr-2 shrink-0">
          {rightAction}
        </div>
      )}
    </div>
  );
};
