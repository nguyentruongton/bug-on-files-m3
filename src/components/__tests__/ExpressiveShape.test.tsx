import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExpressiveShape } from '../ExpressiveShape';

describe('ExpressiveShape', () => {
    test('applies explicit CSS width and height matching ShapeMedia dimensions', () => {
        const html = renderToStaticMarkup(
            <ExpressiveShape
                shape="cookie4Sided"
                width={52}
                height={52}
                style={{ backgroundColor: '#f9b6ae' }}
            >
                <span>icon</span>
            </ExpressiveShape>
        );
        expect(html).toContain('width:52px');
        expect(html).toContain('height:52px');
        expect(html).toContain('background-color:#f9b6ae');
        expect(html).toContain('flex items-center justify-center shrink-0 overflow-hidden');
    });
});
