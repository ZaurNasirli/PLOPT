import React from 'react';
import { Language } from '../../i18n/types';
import { cn } from '../../lib/utils';

interface FlagIconProps {
  code: Language | string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const FlagIcon: React.FC<FlagIconProps> = ({ code, className, size = 'md' }) => {
  const sizeClasses = {
    sm: 'w-4 h-3',
    md: 'w-5 h-3.5',
    lg: 'w-6 h-4'
  }[size];

  const normalized = (code || '').toLowerCase();

  switch (normalized) {
    case 'az':
      return (
        <span
          className={cn(
            "inline-flex shrink-0 overflow-hidden rounded-[2.5px] border border-black/15 dark:border-white/20 shadow-xs select-none",
            sizeClasses,
            className
          )}
          title="Azərbaycan"
        >
          <svg viewBox="0 0 60 40" className="w-full h-full block">
            {/* Top Blue band */}
            <rect width="60" height="13.333" fill="#0092bc" />
            {/* Middle Red band */}
            <rect y="13.333" width="60" height="13.334" fill="#e4002b" />
            {/* Bottom Green band */}
            <rect y="26.667" width="60" height="13.333" fill="#009739" />
            {/* Crescent */}
            <circle cx="28" cy="20" r="6" fill="#ffffff" />
            <circle cx="29.6" cy="20" r="5" fill="#e4002b" />
            {/* 8-pointed star */}
            <polygon
              fill="#ffffff"
              points="
                36,17.4 36.9,18.9 38.6,18.5 37.8,20 38.6,21.5 36.9,21.1 36,22.6
                35.1,21.1 33.4,21.5 34.2,20 33.4,18.5 35.1,18.9
              "
            />
          </svg>
        </span>
      );

    case 'ru':
      return (
        <span
          className={cn(
            "inline-flex shrink-0 overflow-hidden rounded-[2.5px] border border-black/15 dark:border-white/20 shadow-xs select-none",
            sizeClasses,
            className
          )}
          title="Русский"
        >
          <svg viewBox="0 0 60 40" className="w-full h-full block">
            <rect width="60" height="13.333" fill="#ffffff" />
            <rect y="13.333" width="60" height="13.334" fill="#0039a6" />
            <rect y="26.667" width="60" height="13.333" fill="#d52b1e" />
          </svg>
        </span>
      );

    case 'tr':
      return (
        <span
          className={cn(
            "inline-flex shrink-0 overflow-hidden rounded-[2.5px] border border-black/15 dark:border-white/20 shadow-xs select-none",
            sizeClasses,
            className
          )}
          title="Türkçe"
        >
          <svg viewBox="0 0 60 40" className="w-full h-full block">
            {/* Red Field */}
            <rect width="60" height="40" fill="#e30a17" />
            {/* Crescent */}
            <circle cx="22" cy="20" r="10" fill="#ffffff" />
            <circle cx="25" cy="20" r="8" fill="#e30a17" />
            {/* Star */}
            <polygon
              fill="#ffffff"
              points="
                32.5,20 38.5,15.6 34.8,22.7 34.8,17.3 38.5,24.4
              "
            />
          </svg>
        </span>
      );

    case 'en':
    case 'gb':
      return (
        <span
          className={cn(
            "inline-flex shrink-0 overflow-hidden rounded-[2.5px] border border-black/15 dark:border-white/20 shadow-xs select-none",
            sizeClasses,
            className
          )}
          title="English"
        >
          <svg viewBox="0 0 60 40" className="w-full h-full block">
            <clipPath id="gb-clip">
              <rect width="60" height="40" />
            </clipPath>
            <g clipPath="url(#gb-clip)">
              {/* Blue background */}
              <rect width="60" height="40" fill="#012169" />
              {/* White saltire */}
              <path d="M0,0 L60,40 M60,0 L0,40" stroke="#ffffff" strokeWidth="8" />
              {/* Red saltire */}
              <path d="M0,0 L60,40 M60,0 L0,40" stroke="#c8102e" strokeWidth="4.8" />
              {/* White cross */}
              <path d="M30,0 v40 M0,20 h60" stroke="#ffffff" strokeWidth="12" />
              {/* Red cross */}
              <path d="M30,0 v40 M0,20 h60" stroke="#c8102e" strokeWidth="7.2" />
            </g>
          </svg>
        </span>
      );

    default:
      return null;
  }
};
