import React, { useState, useMemo } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface SelectOption {
  value: string;
  label: string;
  sublabel?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
}

export interface SelectProps {
  label?: string;
  value: string;
  onChange: (val: string) => void;
  options: SelectOption[];
  placeholder?: string;
  error?: string;
  hint?: string;
  className?: string;
  wrapperClassName?: string;
  triggerClassName?: string;
  contentClassName?: string;
  disabled?: boolean;
  variant?: 'default' | 'card' | 'ghost';
  size?: 'sm' | 'md';
  searchable?: boolean;
  id?: string;
  name?: string;
  required?: boolean;
}

const EMPTY_SENTINEL = '__EMPTY_SELECT_OPTION__';

export const Select: React.FC<SelectProps> = ({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select...',
  error,
  hint,
  className,
  wrapperClassName,
  triggerClassName,
  contentClassName,
  disabled,
  variant = 'default',
  size = 'md',
  searchable = false,
  id,
  name,
  required,
}) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const safeValue = value ?? '';
  const radixValue = safeValue === '' ? EMPTY_SENTINEL : String(safeValue);

  const mappedOptions = useMemo(() => {
    return options.map((opt) => ({
      ...opt,
      internalValue: opt.value === '' ? EMPTY_SENTINEL : String(opt.value),
    }));
  }, [options]);

  const filteredOptions = useMemo(() => {
    if (!searchable || !searchQuery.trim()) {
      return mappedOptions;
    }
    const q = searchQuery.toLowerCase().trim();
    return mappedOptions.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        (opt.sublabel && opt.sublabel.toLowerCase().includes(q))
    );
  }, [mappedOptions, searchable, searchQuery]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearchQuery('');
    }
  };

  const handleValueChange = (val: string) => {
    const finalVal = val === EMPTY_SENTINEL ? '' : val;
    onChange(finalVal);
  };

  // Base trigger variant styles
  const variantStyles = {
    default:
      'border border-slate-200/90 bg-white text-slate-800 shadow-2xs hover:border-slate-300 focus:border-[#0F766E] focus:ring-2 focus:ring-[#0F766E]/15 data-[state=open]:border-[#0F766E] data-[state=open]:ring-2 data-[state=open]:ring-[#0F766E]/15',
    card:
      'border-0 bg-white text-slate-800 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] focus:ring-2 focus:ring-[#0F766E]/20 data-[state=open]:shadow-[0_4px_12px_rgba(0,0,0,0.06)] data-[state=open]:ring-2 data-[state=open]:ring-[#0F766E]/20',
    ghost:
      'border-0 bg-transparent text-slate-800 hover:bg-slate-100/70 focus:bg-slate-100/70 focus:ring-1 focus:ring-[#0F766E]/20',
  };

  // Size styles
  const sizeStyles = {
    sm: 'h-9 min-h-[36px] px-3 text-xs rounded-lg',
    md: 'h-11 min-h-[42px] px-3.5 text-sm rounded-xl',
  };

  return (
    <div className={twMerge('w-full flex flex-col gap-1', wrapperClassName)}>
      {label && (
        <label
          htmlFor={id}
          className="text-xs font-semibold text-slate-600 tracking-tight select-none flex items-center justify-between"
        >
          <span>
            {label}
            {required && <span className="text-danger ml-0.5">*</span>}
          </span>
        </label>
      )}

      <SelectPrimitive.Root
        value={radixValue}
        onValueChange={handleValueChange}
        disabled={disabled}
        open={open}
        onOpenChange={handleOpenChange}
        name={name}
      >
        <SelectPrimitive.Trigger
          id={id}
          className={twMerge(
            clsx(
              'group flex w-full items-center justify-between gap-2.5 font-medium transition-all select-none overflow-hidden cursor-pointer focus:outline-none',
              variantStyles[variant],
              sizeStyles[size],
              disabled && 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed shadow-none hover:border-slate-200',
              error && 'border-danger focus:border-danger focus:ring-danger/15'
            ),
            className,
            triggerClassName
          )}
        >
          <span className="truncate min-w-0 text-left flex-1 block">
            <SelectPrimitive.Value placeholder={placeholder} />
          </span>
          <SelectPrimitive.Icon asChild>
            <ChevronDown className="h-4 w-4 text-slate-400 shrink-0 transition-transform duration-200 ease-out group-data-[state=open]:rotate-180 pointer-events-none" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>

        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={6}
            collisionPadding={10}
            className={twMerge(
              'z-[80] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-slate-100 bg-white p-1.5 shadow-[0_12px_40px_rgba(15,23,42,0.12),0_2px_8px_rgba(15,23,42,0.04)] data-[state=open]:animate-select-in data-[state=closed]:animate-select-out',
              contentClassName
            )}
          >
            {searchable && (
              <div
                className="p-1 pb-1.5 border-b border-slate-100 mb-1"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="relative flex items-center">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Escape' && searchQuery) {
                        e.preventDefault();
                        setSearchQuery('');
                      }
                    }}
                    placeholder="Search options..."
                    className="w-full h-8 pl-8 pr-7 rounded-lg bg-slate-50 border border-slate-200/90 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-[#0F766E] focus:ring-1 focus:ring-[#0F766E]/20 transition-all"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSearchQuery('');
                      }}
                      className="absolute right-2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            )}

            <SelectPrimitive.Viewport className="p-0.5 space-y-0.5 max-h-64 sm:max-h-72 overflow-y-auto">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((opt) => (
                  <SelectPrimitive.Item
                    key={opt.internalValue}
                    value={opt.internalValue}
                    disabled={opt.disabled}
                    className={clsx(
                      'relative flex w-full cursor-pointer select-none items-center justify-between rounded-xl py-2.5 pl-3 pr-8 text-sm font-medium outline-none transition-colors duration-150',
                      'text-slate-700 data-[highlighted]:bg-slate-50 data-[highlighted]:text-slate-900',
                      'data-[state=checked]:bg-[#EAF2F1] data-[state=checked]:text-[#0F766E] data-[state=checked]:font-semibold',
                      'data-[disabled]:pointer-events-none data-[disabled]:opacity-40'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                      <div className="flex flex-col min-w-0 flex-1">
                        <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
                        {opt.sublabel && (
                          <span className="text-[11.5px] text-slate-400 data-[state=checked]:text-[#0F766E]/80 font-normal truncate mt-0.5">
                            {opt.sublabel}
                          </span>
                        )}
                      </div>
                    </div>
                    <SelectPrimitive.ItemIndicator className="absolute right-2.5 flex h-4 w-4 items-center justify-center pointer-events-none">
                      <Check className="h-4 w-4 text-[#0F766E] stroke-[2.5]" />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))
              ) : (
                <div className="py-4 px-3 text-center text-xs text-slate-400 select-none">
                  No matching options found
                </div>
              )}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>

      {error ? (
        <span className="text-[12.5px] text-danger font-normal">{error}</span>
      ) : hint ? (
        <span className="text-[12px] text-slate-500">{hint}</span>
      ) : null}
    </div>
  );
};
