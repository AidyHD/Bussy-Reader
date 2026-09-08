export type PdfTransform = readonly [number, number, number, number, number, number];

export type PdfTextItem = {
  str?: string;
};

export type PdfTextPart = {
  item: PdfTextItem;
  part: string;
  start: number;
  end: number;
};

export type PdfTextItemLayout = {
  left: number;
  top: number;
  fontHeight: number;
  angle: number;
};

export const multiplyPdfTransforms = (
  first: PdfTransform,
  second: PdfTransform,
): PdfTransform => [
  first[0] * second[0] + first[2] * second[1],
  first[1] * second[0] + first[3] * second[1],
  first[0] * second[2] + first[2] * second[3],
  first[1] * second[2] + first[3] * second[3],
  first[0] * second[4] + first[2] * second[5] + first[4],
  first[1] * second[4] + first[3] * second[5] + first[5],
];

export const getPdfTextItemLayout = (
  viewportTransform: PdfTransform,
  itemTransform: PdfTransform,
): PdfTextItemLayout => {
  const tx = multiplyPdfTransforms(viewportTransform, itemTransform);
  const fontHeight = Math.max(1, Math.hypot(tx[2], tx[3]));
  return {
    left: tx[4],
    top: tx[5] - fontHeight,
    fontHeight,
    angle: Math.atan2(tx[1], tx[0]),
  };
};

export const extractPdfTextParts = (items: readonly PdfTextItem[]) => {
  const parts: PdfTextPart[] = [];
  let text = '';
  items.forEach((item) => {
    if (typeof item.str !== 'string') return;
    const part = item.str.replace(/\s+/g, ' ');
    if (!part) return;
    if (parts.length) text += ' ';
    const start = text.length;
    text += part;
    parts.push({ item, part, start, end: text.length });
  });
  return { parts, text };
};

export const getPdfHighlightBackground = (offset: number, start: number, end: number) => {
  const activeHighlightOffset = Math.max(0, Number(offset) || 0);
  const length = Math.max(1, end - start);
  if (activeHighlightOffset <= start) return 'transparent';
  if (activeHighlightOffset >= end) return 'rgba(128, 128, 128, 0.38)';
  const progress = Math.max(0, Math.min(100, ((activeHighlightOffset - start) / length) * 100));
  return `linear-gradient(to right, rgba(128, 128, 128, 0.38) 0%, rgba(128, 128, 128, 0.38) ${progress}%, transparent ${progress}%, transparent 100%)`;
};