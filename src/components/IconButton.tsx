import React from 'react';
import { IconButton as M3IconButton } from '@bug-on/m3-expressive';

export interface IconButtonProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    'color' | 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd'
  > {
  variant?: 'standard' | 'filled' | 'tonal' | 'outlined';
  colorStyle?: 'standard' | 'filled' | 'tonal' | 'outlined';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  toggle?: boolean;
  selected?: boolean;
}

export const IconButton: React.FC<IconButtonProps> = ({
  variant = 'standard',
  colorStyle,
  size = 'sm',
  toggle,
  selected,
  className = '',
  children,
  title,
  'aria-label': ariaLabel,
  type = 'button',
  ...props
}) => {
  const resolvedColorStyle = colorStyle ?? variant;
  const resolvedAriaLabel = ariaLabel ?? title ?? 'Action';

  if (toggle || selected !== undefined) {
    return (
      <M3IconButton
        type={type}
        variant="toggle"
        selected={Boolean(selected)}
        colorStyle={resolvedColorStyle}
        size={size}
        className={className}
        title={title}
        aria-label={resolvedAriaLabel}
        {...props}
      >
        {children}
      </M3IconButton>
    );
  }

  return (
    <M3IconButton
      type={type}
      colorStyle={resolvedColorStyle}
      size={size}
      className={className}
      title={title}
      aria-label={resolvedAriaLabel}
      {...props}
    >
      {children}
    </M3IconButton>
  );
};
