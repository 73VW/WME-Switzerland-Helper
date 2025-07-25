export function measureTextWidth(text: string, font = '14px "Rubik", "Waze Boing", "Waze Boing HB light", sans-serif') {
  const canvas = measureTextWidth.canvas || (measureTextWidth.canvas = document.createElement('canvas'));
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  return ctx.measureText(text).width;
}

export function getNaturalBoxSize(label: string, value: string, extra = '') {
  const paddingX = 5;
  const paddingY = 5;
  const fontSize = 14;
  const lineHeight = 18;
  const font = `${fontSize}px "Rubik", "Waze Boing", "Waze Boing HB light", sans-serif`;
  const labelWidth = measureTextWidth(label, font);
  const valueWidth = measureTextWidth(value, font);
  const extraWidth = measureTextWidth(extra, font);
  const textWidth = Math.max(labelWidth, valueWidth, extraWidth);
  const width = Math.ceil(textWidth + 2 * paddingX);
  const height = 3 * lineHeight + 2 * paddingY;
  return { width, height, paddingY };
}

export function createAutoScalingSvg(label: string, value: string, extra = '') {
  const { width: boxWidth, height: boxHeight, paddingY } = getNaturalBoxSize(label, value, extra);
  const fontSize = 14;
  const lineHeight = 18;
  const textX = boxWidth / 2;
  const labelY = paddingY + lineHeight - 2;
  const valueY = paddingY + 2 * lineHeight - 2;
  const extraY = paddingY + 3 * lineHeight - 2;
  return `\n<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 ${boxWidth} ${boxHeight}">\n  <defs>\n    <filter id="wmeShadow" x="-50%" y="-50%" width="200%" height="200%">\n      <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.2" />\n    </filter>\n  </defs>\n\n  <rect x="0" y="0" rx="6" ry="6" width="${boxWidth}" height="${boxHeight}"\n        fill="#f0f3f5" stroke="#ccc" filter="url(#wmeShadow)" />\n\n  <text x="${textX}" y="${labelY}"\n        font-size="${fontSize}" font-family="Segoe UI, sans-serif"\n        fill="#333" text-anchor="middle">\n    ${label}\n  </text>\n  <text x="${textX}" y="${valueY}"\n        font-size="${fontSize}" font-family="Segoe UI, sans-serif"\n        fill="#666" text-anchor="middle">\n    ${value}\n  </text>\n  <text x="${textX}" y="${extraY}"\n        font-size="${fontSize}" font-family="Segoe UI, sans-serif"\n        fill="#999" text-anchor="middle">\n    ${extra}\n  </text>\n</svg>`;
}

export function svgToBase64(svgString: string) {
  const utf8Bytes = new TextEncoder().encode(svgString);
  const binary = Array.from(utf8Bytes, (b) => String.fromCharCode(b)).join('');
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}
