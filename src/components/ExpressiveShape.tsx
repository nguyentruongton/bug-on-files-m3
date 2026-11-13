import React from 'react';
import { ShapeMedia } from '@bug-on/m3-expressive';

export interface ExpressiveShapeProps
    extends Omit<React.ComponentProps<typeof ShapeMedia>, 'width' | 'height'> {
    width: number;
    height: number;
}

/**
 * Wraps ShapeMedia and enforces explicit CSS width/height matching the clipPath
 * dimensions so inner icons, text, and thumbnails never shrink or clip off-center.
 */
export const ExpressiveShape: React.FC<ExpressiveShapeProps> = ({
    width,
    height,
    className = '',
    style,
    children,
    ...rest
}) => {
    return (
        <ShapeMedia
            width={width}
            height={height}
            className={`flex items-center justify-center shrink-0 overflow-hidden ${className}`.trim()}
            style={{ width, height, ...style }}
            {...rest}
        >
            {children}
        </ShapeMedia>
    );
};
