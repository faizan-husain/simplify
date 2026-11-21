import React, { useState, useRef, useEffect, useId } from 'react';
import { Search, Plus, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

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
  hint?: string;
  className?: string;
  recentItems?: ComboboxItem[];
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
  hint,
  className,
  recentItems = [],
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

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

  const showAddNew = Boolean(
    onAddNew &&
    query.trim() !== '' &&
    !items.some((i) => i.label.toLowerCase() === query.trim().toLowerCase())
  );

  const totalOptions = filteredItems.length + (showAddNew ? 1 : 0);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setIsOpen(true);
    setActiveIndex(0);
    if (allowCustomText && onCustomTextChange) {
      onCustomTextChange(val);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
        return;
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % totalOptions);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? totalOptions - 1 : prev - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < filteredItems.length) {
        const item = filteredItems[activeIndex];
        onSelect(item);
        setQuery(item.label);
        setIsOpen(false);
      } else if (showAddNew && activeIndex === filteredItems.length) {
        onAddNew?.(query.trim());
        setIsOpen(false);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const highlightMatch = (text: string, q: string) => {
    if (!q.trim()) return text;
    const index = text.toLowerCase().indexOf(q.toLowerCase());
    if (index === -1) return text;
    const before = text.substring(0, index);
    const match = text.substring(index, index + q.length);
    const after = text.substring(index + q.length);
    return (
      <>
        {before}
        <strong className="font-semibold text-text">{match}</strong>
        {after}
      </>
    );
  };

  return (
    <div ref={containerRef} className={clsx('relative w-full flex flex-col gap-1', className)}>
      {label && (
        <label htmlFor={inputId} className="text-[13px] font-medium text-text-muted select-none">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        <Search className="absolute left-3.5 w-4 h-4 text-text-muted pointer-events-none" />
        <input
          id={inputId}
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={twMerge(
            clsx(
              'w-full h-[42px] min-h-[44px] sm:min-h-[42px] pl-10 pr-3.5 rounded-control border bg-white text-text text-[14px] transition-all',
              'border-border placeholder:text-placeholder hover:border-slate-300',
              'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15',
              error && 'border-danger focus:border-danger focus:ring-danger/15'
            )
          )}
        />
      </div>

      {isOpen && (
        <div
          ref={listRef}
          className="absolute top-[calc(100%+4px)] left-0 right-0 z-50 max-h-[320px] overflow-y-auto rounded-[14px] border border-border bg-white p-1.5 shadow-pop animate-in fade-in-80"
        >
          {query.trim() === '' && recentItems.length > 0 && (
            <div className="px-2 pt-1 pb-1.5 border-b border-divider mb-1">
              <span className="text-[11.5px] font-medium text-text-muted uppercase tracking-wider block mb-1">
                Recent
              </span>
              <div className="flex flex-wrap gap-1">
                {recentItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onSelect(item);
                      setQuery(item.label);
                      setIsOpen(false);
                    }}
                    className="inline-flex items-center px-2 py-0.5 rounded-md text-[12.5px] bg-surface-2 text-text hover:bg-surface-3 transition-colors"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {filteredItems.length > 0 ? (
            filteredItems.map((item, index) => {
              const isSelected = item.id === selectedId;
              const isActive = index === activeIndex;

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    onSelect(item);
                    setQuery(item.label);
                    setIsOpen(false);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={clsx(
                    'flex items-center justify-between px-3 py-2 rounded-[8px] cursor-pointer text-[14px] select-none transition-colors min-h-[38px]',
                    isActive ? 'bg-surface-2 text-text' : 'text-text',
                    isSelected && 'font-medium'
                  )}
                >
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="truncate">{highlightMatch(item.label, query)}</span>
                    {item.sublabel && (
                      <span className="text-[12px] text-text-muted truncate">{item.sublabel}</span>
                    )}
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-accent ml-2 flex-shrink-0" />}
                </div>
              );
            })
          ) : (
            <div className="py-2.5 px-3 text-[13px] text-text-muted text-center">No matches found</div>
          )}

          {showAddNew && (
            <div
              onClick={() => {
                onAddNew?.(query.trim());
                setIsOpen(false);
              }}
              onMouseEnter={() => setActiveIndex(filteredItems.length)}
              className={clsx(
                'mt-1 border-t border-divider pt-1.5 flex items-center gap-2 px-3 py-2 rounded-[8px] cursor-pointer text-[13.5px] text-accent font-medium select-none transition-colors',
                activeIndex === filteredItems.length ? 'bg-accent-soft' : 'hover:bg-accent-soft'
              )}
            >
              <Plus className="w-4 h-4" />
              <span>{addNewLabel}: &ldquo;{query.trim()}&rdquo;</span>
            </div>
          )}
        </div>
      )}
      {error ? (
        <span className="text-[12.5px] text-danger font-normal">{error}</span>
      ) : hint ? (
        <span className="text-[12px] text-text-muted">{hint}</span>
      ) : null}
    </div>
  );
};

