export const isHexColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value);
export function normalizeHex(value: string) {
  const v = value.trim();
  if (/^#[0-9a-f]{3}$/i.test(v))
    return (
      "#" +
      [...v.slice(1)]
        .map((c) => c + c)
        .join("")
        .toLowerCase()
    );
  return isHexColor(v) ? v.toLowerCase() : null;
}
export function hexRgb(hex: string) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
export function withAlpha(hex: string, alpha: number) {
  return `rgba(${hexRgb(hex).join(",")},${Math.max(0, Math.min(1, alpha))})`;
}
export function hslHex(h: number, s: number, l: number) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = l - c / 2;
  const rgb =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return (
    "#" +
    rgb
      .map((v) =>
        Math.round((v + m) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function hexHsl(hex: string) {
  const [r, g, b] = hexRgb(hex).map((v) => v / 255),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min,
    l = (max + min) / 2;
  let h = 0;
  if (d)
    h =
      max === r
        ? ((g - b) / d) % 6
        : max === g
          ? (b - r) / d + 2
          : (r - g) / d + 4;
  return {
    h: (((h * 60) % 360) + 360) % 360,
    s: d ? (d / (1 - Math.abs(2 * l - 1))) * 100 : 0,
    l: l * 100,
  };
}
export function luminance(hex: string) {
  const [r, g, b] = hexRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function readableColor(background: string, preferred: string) {
  const a = luminance(background),
    b = luminance(preferred);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5
    ? preferred
    : a > 0.179
      ? "#000000"
      : "#ffffff";
}
