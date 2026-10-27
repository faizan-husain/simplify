import React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label?: string;
  value: string;
  onChange: (val: string) => void;
  options: SelectOption[];
  placeholder?: string;
  error?: string;
  className?: string;
}

export const Select: React.FC<SelectProps> = ({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select...',
  error,
  className,
}) => {
  return (
    <div className="w-full flex flex-col gap-1.5">
      {label && <span className="text-xs font-semibold text-text-muted">{label}</span>}
      <SelectPrimitive.Root value={value} onValueChange={onChange}>
        <SelectPrimitive.Trigger
          className={twMerge(
            clsx(
              'flex h-11 w-full items-center justify-between rounded-lg border border-border bg-white px-3.5 text-sm transition-colors min-h-[44px]',
              'hover:border-gray-400 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary',
              error && 'border-danger focus:border-danger focus:ring-danger',
              className
            )
          )}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon asChild>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={4}
            className="z-50 min-w-[8rem] overflow-hidden rounded-lg border border-border bg-white shadow-md animate-in fade-in-80"
          >
            <SelectPrimitive.Viewport className="p-1">
              {options.map((opt) => (
                <SelectPrimitive.Item
                  key={opt.value}
                  value={opt.value}
                  className="relative flex w-full cursor-pointer select-none items-center rounded-md py-2.5 pl-8 pr-3 text-sm outline-none focus:bg-surface focus:text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                >
                  <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                    <SelectPrimitive.ItemIndicator>
                      <Check className="h-4 w-4 text-primary" />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                  <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {error && <span className="text-xs text-danger font-medium">{error}</span>}
    </div>
  );
};
