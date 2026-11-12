import React from 'react';
import { Button as M3Button, type MD3ColorStyle, type MD3Size } from '@bug-on/m3-expressive';

export interface ButtonProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    'color' | 'value' | 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd'
  > {
  variant?: 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated';
  colorStyle?: MD3ColorStyle;
  size?: MD3Size;
  icon?: React.ReactNode;
  value?: string;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'filled',
  colorStyle,
  size = 'sm',
  icon,
  children,
  className = '',
  type = 'button',
  ...props
}) => {
  return (
    <M3Button
      type={type}
      colorStyle={colorStyle ?? variant}
      size={size}
      icon={icon}
      className={className}
      {...props}
    >
      {children}
    </M3Button>
  );
};
