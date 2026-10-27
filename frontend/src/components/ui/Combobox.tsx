import React, { useState, useRef, useEffect } from 'react';
import { Search, Plus, Check } from 'lucide-react';
import { clsx } from 'clsx';

export interface ComboboxItem {
  id: string;
  label: string;
  sublabel?: string;
  meta?: any;
}

export interface ComboboxProps {
  label?: string;
  items: ComboboxItem[];
  selectedId?: string | null;
  onSelect: (item: ComboboxItem) => void;
  onAddNew?: (text: string) => void;
  placeholder?: string;
  addNewLabel?: string;
  allowCustomText?: boolean;
  onCustomTextChange?: (text: string) => void;
  error?: string;
  className?: string;
}

export const Combobox: React.FC<ComboboxProps> = ({
  label,
  items,
  selectedId,
  onSelect,
  onAddNew,
  placeholder = 'Search...',
  addNewLabel = '+ Add New',
  allowCustomText,
  onCustomTextChange,
  error,
  className,
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedItem = items.find((i) => i.id === selectedId);

  // Sync query when selectedItem changes
  useEffect(() => {
    if (selectedItem) {
      setQuery(selectedItem.label);
    }
  }, [selectedItem]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredItems = query.trim() === ''
    ? items
    : items.filter((i) =>
        i.label.toLowerCase().includes(query.toLowerCase()) ||
        (i.sublabel && i.sublabel.toLowerCase().includes(query.toLowerCase()))
      );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setIsOpen(true);
    if (allowCustomText && onCustomTextChange) {
      onCustomTextChange(val);
    }
  };

  return (
    <div ref={containerRef} className={clsx('relative w-full flex flex-col gap-1.5', className)}>
      {label && <label className="text-xs font-semibold text-text-muted">{label}</label>}
      <div className="relative flex items-center">
        <Search className="absolute left-3 w-4 h-4 text-text-muted pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className={clsx(
            'w-full h-11 pl-9 pr-3.5 rounded-lg border bg-white text-text text-sm transition-colors min-h-[44px]',
            'border-border hover:border-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary',
            error && 'border-danger focus:border-danger focus:ring-danger'
          )}
        />
      </div>

      {isOpen && (
        <div className="absolute top-[100%] left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-white p-1 shadow-lg">
          {filteredItems.length > 0 ? (
            filteredItems.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  onSelect(item);
                  setQuery(item.label);
                  setIsOpen(false);
                }}
                className={clsx(
                  'flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer text-sm select-none transition-colors min-h-[40px]',
                  item.id === selectedId ? 'bg-primary-light text-primary font-medium' : 'hover:bg-surface text-text'
                )}
              >
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="truncate">{item.label}</span>
                  {item.sublabel && (
                    <span className="text-xs text-text-muted truncate">{item.sublabel}</span>
                  )}
                </div>
                {item.id === selectedId && <Check className="w-4 h-4 text-primary ml-2 flex-shrink-0" />}
              </div>
            ))
          ) : (
            <div className="py-2 px-3 text-xs text-text-muted">No matches</div>
          )}

          {onAddNew && query.trim() !== '' && !items.some((i) => i.label.toLowerCase() === query.trim().toLowerCase()) && (
            <div
              onClick={() => {
                onAddNew(query.trim());
                setIsOpen(false);
              }}
              className="mt-1 border-t border-border pt-1 flex items-center gap-2 px-3 py-2.5 rounded-md cursor-pointer text-sm text-primary font-medium hover:bg-surface select-none"
            >
              <Plus className="w-4 h-4" />
              <span>{addNewLabel}: "{query.trim()}"</span>
            </div>
          )}
        </div>
      )}
      {error && <span className="text-xs text-danger font-medium">{error}</span>}
    </div>
  );
};
