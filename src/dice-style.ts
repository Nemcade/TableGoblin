import type { Mood } from "./mood";
import { hexHsl, hslHex, luminance, readableColor } from "./colors.ts";
export function dicePalette(
  mood: Mood,
  color: string | null = null,
  fontColor: string | null = null,
) {
  const hsl = color
    ? hexHsl(color)
    : {
        h: mood.hue - 22,
        s: Math.min(80, (mood.saturation * 15) / 7),
        l: 58.35 + (mood.lightness - 17) * 0.15,
      };
  const face = hslHex(hsl.h, hsl.s, hsl.l);
  return {
    ...hsl,
    color: face,
    fontColor:
      fontColor ??
      readableColor(
        face,
        luminance(face) > 0.179
          ? hslHex(hsl.h + 7, Math.min(35, (hsl.s * 35) / 15), 6)
          : "#ffffff",
      ),
    edge: hslHex(hsl.h, Math.min(18, hsl.s), hsl.l > 80 ? 35 : 82),
  };
}
