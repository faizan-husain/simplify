import React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={twMerge(
      clsx(
        'inline-flex items-center justify-start gap-6 border-b border-divider bg-transparent p-0 text-text-muted overflow-x-auto max-w-full no-scrollbar',
        className
      )
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

export interface TabsTriggerProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  count?: number;
}

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(({ className, count, children, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={twMerge(
      clsx(
        'group relative inline-flex items-center justify-center gap-2 whitespace-nowrap pb-3 pt-1 text-[14px] font-medium text-text-muted transition-colors select-none outline-none',
        'hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20',
        'disabled:pointer-events-none disabled:opacity-50',
        'data-[state=active]:text-text data-[state=active]:font-semibold',
        'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-transparent after:transition-all after:duration-200',
        'data-[state=active]:after:bg-accent',
        className
      )
    )}
    {...props}
  >
    <span>{children}</span>
    {typeof count === 'number' && (
      <span className="text-[11px] font-medium tabular-nums px-1.5 py-0.5 rounded-full bg-surface-2 text-text-muted group-data-[state=active]:bg-surface-3 group-data-[state=active]:text-text">
        {count}
      </span>
    )}
  </TabsPrimitive.Trigger>
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={twMerge(clsx('mt-4 focus-visible:outline-none', className))}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
