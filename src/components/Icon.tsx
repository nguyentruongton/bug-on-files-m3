import React from 'react';
import { Icon as M3Icon, type IconProps as M3IconProps } from '@bug-on/m3-expressive';

export interface IconProps extends Omit<M3IconProps, 'fill' | 'opticalSize' | 'size'> {
  name: string;
  className?: string;
  filled?: boolean;
  fill?: 0 | 1;
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700;
  grade?: -50 | -25 | 0 | 100 | 200;
  opticalSize?: 20 | 24 | 40 | 48;
  animateFill?: boolean;
  size?: number;
  style?: React.CSSProperties;
}

export const Icon: React.FC<IconProps> & { isMD3Icon?: boolean } = ({
  name,
  variant = 'rounded',
  className = '',
  filled = false,
  fill,
  weight = 400,
  grade = 0,
  opticalSize,
  animateFill = false,
  size,
  style,
  ...rest
}) => {
  const effectiveFill: 0 | 1 = fill !== undefined ? fill : filled ? 1 : 0;
  const resolvedOpsz: 20 | 24 | 40 | 48 =
    opticalSize ?? (size && size <= 20 ? 20 : size && size >= 48 ? 48 : size && size >= 40 ? 40 : 24);

  return (
    <M3Icon
      name={name}
      variant={variant}
      fill={effectiveFill}
      weight={weight}
      grade={grade}
      opticalSize={resolvedOpsz}
      size={size}
      animateFill={animateFill}
      className={className}
      style={style}
      {...rest}
    />
  );
};

Icon.isMD3Icon = true;
