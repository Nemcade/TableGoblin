import { hslHex, luminance, withAlpha, readableColor } from "./colors.ts";
export type MoodMotion = "still" | "campfire" | "canopy";
export type Mood = {
  hue: number;
  saturation: number;
  lightness: number;
  gradient: number;
  texture: number;
  motion: MoodMotion;
  amount: number;
  speed: number;
  campfireColor: string;
  canopyColor: string;
  spread: number;
  variation: number;
};
export const defaultMood: Mood = {
  hue: 144,
  saturation: 7,
  lightness: 17,
  gradient: 1,
  texture: 1,
  motion: "still",
  amount: 0.35,
  speed: 0.35,
  campfireColor: "#e9a85d",
  canopyColor: "#000804",
  spread: 1,
  variation: 1,
};
export function themePalette(mood: Mood) {
  const panelLight =
    mood.lightness < 12
      ? mood.lightness * 0.9
      : mood.lightness < 50
        ? mood.lightness - 3
        : Math.min(100, mood.lightness + 3);
  const scaled = (base: number, limit = 40) =>
    Math.min(limit, (mood.saturation * base) / 7);
  const panel = hslHex(mood.hue, scaled(12), panelLight),
    lum = luminance(panel),
    dark = lum <= 0.179;
  return {
    panel,
    dark,
    ink: readableColor(
      panel,
      hslHex(
        mood.hue,
        scaled(20),
        dark ? (lum > 0.1 ? 100 : 82) : lum < 0.3 ? 0 : 6,
      ),
    ),
    muted: readableColor(
      panel,
      hslHex(
        mood.hue,
        scaled(13),
        dark ? (lum > 0.1 ? 100 : lum > 0.04 ? 82 : 61) : lum < 0.3 ? 0 : 20,
      ),
    ),
    border: hslHex(
      mood.hue,
      scaled(13),
      Math.max(0, Math.min(100, panelLight + (dark ? 16 : -22))),
    ),
    accent: hslHex(mood.hue, scaled(28, 75), dark ? 74 : 24),
    onAccent: hslHex(mood.hue, scaled(12), dark ? 6 : 100),
  };
}
export function backgroundFinish(mood: Mood) {
  return Math.max(
    0,
    Math.min(1, mood.lightness / 8, (100 - mood.lightness) / 8),
  );
}
export function moodVariables(mood: Mood): Record<string, string> {
  const palette = themePalette(mood);
  return {
    "--mood-hue": String(mood.hue),
    "--mood-panel": palette.panel,
    "--mood-border": withAlpha(palette.border, 0.65),
    "--mood-ink": palette.ink,
    "--mood-muted": palette.muted,
    "--mood-accent": palette.accent,
    "--mood-on-accent": palette.onAccent,
    "--mood-hover": withAlpha(palette.ink, 0.08),
    "--mood-active": withAlpha(palette.accent, 0.13),
  };
}
export function paintAtmosphere(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  mood: Mood,
  now: number,
) {
  const t = (now / 1000) * (mood.speed === 0 ? 0 : 0.12 + mood.speed * 0.45);
  ctx.save();
  ctx.globalAlpha *= mood.gradient * backgroundFinish(mood);
  const glow = ctx.createRadialGradient(
    w * 0.45,
    h * 0.4,
    10,
    w * 0.5,
    h * 0.5,
    w * 0.8,
  );
  glow.addColorStop(
    0,
    withAlpha(
      hslHex(mood.hue, Math.min(100, (mood.saturation * 20) / 7), 68),
      0.06,
    ),
  );
  glow.addColorStop(1, "rgba(0,0,0,.14)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  if (mood.motion === "still" || !mood.amount) return;
  if (mood.motion === "campfire") {
    const breath =
      0.8 +
      mood.variation *
        (0.1 * Math.sin(t * 7) +
          0.06 * Math.sin(t * 13.3) +
          0.04 * Math.sin(t * 3.2));
    const light = ctx.createRadialGradient(
      w * (0.43 + 0.025 * mood.variation * Math.sin(t * 0.8)),
      h * 0.85,
      0,
      w * 0.45,
      h * 0.8,
      w * 0.7 * mood.spread,
    );
    light.addColorStop(
      0,
      withAlpha(mood.campfireColor, mood.amount * 0.22 * breath),
    );
    light.addColorStop(
      0.5,
      withAlpha(mood.campfireColor, mood.amount * 0.045 * breath),
    );
    light.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.save();
    ctx.translate(w * 0.5, h * 0.5);
    ctx.rotate(-0.35);
    for (let i = 0; i < 3; i++) {
      const x =
          (Math.sin(t * 0.6 + i * 1.9) * 0.18 * mood.variation +
            (i - 1) * 0.45) *
          w,
        y = Math.sin(t * 0.4 + i) * h * 0.12 * mood.variation;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, 0.38);
      const shade = ctx.createRadialGradient(
        0,
        0,
        0,
        0,
        0,
        w * 0.5 * mood.spread,
      );
      shade.addColorStop(0, withAlpha(mood.canopyColor, mood.amount * 0.12));
      shade.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = shade;
      ctx.fillRect(
        -w * 0.6 * mood.spread,
        -w * 0.6 * mood.spread,
        w * 1.2 * mood.spread,
        w * 1.2 * mood.spread,
      );
      ctx.restore();
    }
    ctx.restore();
  }
}
