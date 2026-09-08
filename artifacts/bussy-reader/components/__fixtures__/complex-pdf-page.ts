import type { PdfTransform } from '../pdf-text-layer';

export type ComplexPdfTextFixture = {
  name: string;
  viewportTransform: PdfTransform;
  items: Array<{ str: string; transform: PdfTransform }>;
};

export const complexPdfPages: ComplexPdfTextFixture[] = [
  {
    name: 'multi-line mixed layout with rotated callout',
    viewportTransform: [1.25, 0, 0, 1.25, 18, 24],
    items: [
      { str: 'A heading with an unusual font', transform: [0.96, 0.1, -0.1, 0.96, 42, 64] },
      { str: 'The first paragraph continues on its own line.', transform: [0.82, 0, 0, 0.82, 42, 116] },
      { str: 'The second paragraph has a separate baseline.', transform: [0.82, 0, 0, 0.82, 42, 140] },
      { str: 'A right-column note', transform: [0.7, 0, 0, 0.7, 342, 104] },
      { str: 'rotated label', transform: [0, 0.76, -0.76, 0, 478, 242] },
    ],
  },
  {
    name: 'next page after navigation',
    viewportTransform: [0.9, 0, 0, 0.9, 30, 20],
    items: [
      { str: 'A table row on the next page', transform: [0.74, 0, 0, 0.74, 56, 88] },
      { str: 'A footer with a different baseline', transform: [0.62, 0, 0, 0.62, 56, 690] },
    ],
  },
];