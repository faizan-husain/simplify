import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  image?: string | null;
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  size = 'md',
  image,
  className,
  ...props
}) => {
  const getInitials = (str: string) => {
    if (!str) return 'U';
    const parts = str.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const sizeClasses = {
    sm: 'w-7 h-7 text-[11px]',
    md: 'w-9 h-9 text-[13px]',
    lg: 'w-11 h-11 text-[15px]',
  };

  return (
    <div
      className={twMerge(
        clsx(
          'rounded-full flex items-center justify-center font-semibold select-none flex-shrink-0 uppercase overflow-hidden',
          sizeClasses[size],
          image ? 'bg-surface-2' : 'bg-accent-soft text-accent border border-accent/20',
          className
        )
      )}
      {...props}
    >
      {image ? (
        <img src={image} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span>{getInitials(name)}</span>
      )}
    </div>
  );
};
