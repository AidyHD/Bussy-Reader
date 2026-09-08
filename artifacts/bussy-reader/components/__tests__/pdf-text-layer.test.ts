import {
  extractPdfTextParts,
  getPdfHighlightBackground,
  getPdfTextItemLayout,
} from '../pdf-text-layer';
import { complexPdfPages } from '../__fixtures__/complex-pdf-page';

describe('PDF text-layer alignment fixtures', () => {
  it('keeps multi-line, mixed-layout, and rotated text anchored to PDF.js coordinates', () => {
    const fixture = complexPdfPages[0];
    const { parts, text } = extractPdfTextParts(fixture.items);
    const layouts = fixture.items.map(({ transform }) => getPdfTextItemLayout(fixture.viewportTransform, transform));

    expect(text).toBe(
      'A heading with an unusual font The first paragraph continues on its own line. The second paragraph has a separate baseline. A right-column note rotated label',
    );
    expect(parts.map(({ start, end }) => [start, end])).toEqual([
      [0, 30],
      [31, 77],
      [78, 123],
      [124, 143],
      [144, 157],
    ]);
    expect(layouts[0].left).toBeCloseTo(70.5);
    expect(layouts[0].top).toBeCloseTo(102.7935, 4);
    expect(layouts[0].fontHeight).toBeCloseTo(1.20649, 4);
    expect(layouts[0].angle).toBeCloseTo(0.10379, 4);
    expect(layouts.slice(1)).toEqual([
      { left: 70.5, top: 167.975, fontHeight: 1.025, angle: 0 },
      { left: 70.5, top: 197.975, fontHeight: 1.025, angle: 0 },
      { left: 445.5, top: 153, fontHeight: 1, angle: 0 },
      { left: 615.5, top: 325.5, fontHeight: 1, angle: 1.5707963267948966 },
    ]);
    expect(layouts[1].left).toBe(layouts[2].left);
    expect(layouts[1].top).toBeLessThan(layouts[2].top);
    expect(layouts[3].left).toBeGreaterThan(layouts[1].left);
    expect(layouts[4].angle).toBeCloseTo(Math.PI / 2);
  });

  it('keeps a navigated page in its own coordinate space and moves highlight progress during scrubbing', () => {
    const firstPage = complexPdfPages[0];
    const nextPage = complexPdfPages[1];
    const firstPageLayout = getPdfTextItemLayout(firstPage.viewportTransform, firstPage.items[0].transform);
    const nextPageLayout = getPdfTextItemLayout(nextPage.viewportTransform, nextPage.items[0].transform);

    expect(nextPageLayout).not.toEqual(firstPageLayout);
    expect(nextPageLayout.left).toBe(80.4);
    expect(nextPageLayout.top).toBe(98.2);

    expect(getPdfHighlightBackground(0, 32, 79)).toBe('transparent');
    expect(getPdfHighlightBackground(55, 32, 79)).toBe(
      'linear-gradient(to right, rgba(128, 128, 128, 0.38) 0%, rgba(128, 128, 128, 0.38) 48.93617021276596%, transparent 48.93617021276596%, transparent 100%)',
    );
    expect(getPdfHighlightBackground(79, 32, 79)).toBe('rgba(128, 128, 128, 0.38)');
  });
});