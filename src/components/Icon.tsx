import React from 'react';
import { motion } from 'motion/react';
import { FAST_EFFECTS_TRANSITION } from '@bug-on/m3-expressive';

export interface IconProps {
  name: string;
  className?: string;
  filled?: boolean;
  fill?: 0 | 1;
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700;
  grade?: -25 | 0 | 200;
  opticalSize?: 20 | 24 | 40 | 48;
  animateFill?: boolean;
  size?: number;
  style?: React.CSSProperties;
}

export const Icon: React.FC<IconProps> = ({
  name,
  className = '',
  filled = false,
  fill,
  weight = 400,
  grade = 0,
  opticalSize,
  animateFill = false,
  size,
  style = {},
}) => {
  const effectiveFill: 0 | 1 = fill !== undefined ? fill : filled ? 1 : 0;
  const resolvedOpsz = opticalSize ?? (size && size <= 20 ? 20 : size && size >= 40 ? 40 : 24);
  const fontVariationSettings = `'FILL' ${effectiveFill}, 'wght' ${weight}, 'GRAD' ${grade}, 'opsz' ${resolvedOpsz}`;
  const baseClassName = `material-symbols-rounded select-none inline-flex items-center justify-center leading-none ${className}`;
  const baseStyle: React.CSSProperties = {
    fontVariationSettings,
    ...(size ? { fontSize: `${size}px` } : {}),
    ...style,
  };

  if (animateFill) {
    return (
      <motion.span
        className={baseClassName}
        style={baseStyle}
        initial={false}
        animate={{ fontVariationSettings }}
        transition={FAST_EFFECTS_TRANSITION}
        aria-hidden="true"
      >
        {name}
      </motion.span>
    );
  }

  return (
    <span className={baseClassName} style={baseStyle} aria-hidden="true">
      {name}
    </span>
  );
};
