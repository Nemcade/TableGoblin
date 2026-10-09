import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultMood, backgroundFinish, themePalette } from "../src/mood.ts";
import {
  hslHex,
  hexHsl,
  hexRgb,
  luminance,
  normalizeHex,
} from "../src/colors.ts";
import { dicePalette } from "../src/dice-style.ts";
import { TableDice } from "../src/dice.ts";
const contrast = (a: string, b: string) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
test("color conversions preserve precise custom colors, including black and white", () => {
  for (const color of [
    "#000000",
    "#ffffff",
    "#ff0000",
    "#00ff00",
    "#0000ff",
    "#abcd12",
    "#142938",
  ]) {
    const { h, s, l } = hexHsl(color);
    assert.equal(hslHex(h, s, l), color);
  }
  assert.equal(normalizeHex("#aBc"), "#aabbcc");
  assert.equal(normalizeHex("bad"), null);
});
test("theme controls stay readable across saturation and the full lightness range", () => {
  for (let hue = 0; hue < 360; hue += 30)
    for (const saturation of [0, 7, 50, 100])
      for (let lightness = 0; lightness <= 100; lightness += 5) {
        const p = themePalette({ ...defaultMood, hue, saturation, lightness });
        assert.ok(
          contrast(p.panel, p.ink) >= 4.5,
          `text contrast at ${hue}/${saturation}/${lightness}`,
        );
        assert.ok(
          contrast(p.accent, p.onAccent) >= 4.5,
          `button contrast at ${hue}/${saturation}/${lightness}`,
        );
        if (!saturation)
          for (const color of [p.panel, p.ink, p.muted, p.accent, p.onAccent]) {
            const [r, g, b] = hexRgb(color);
            assert.equal(r, g);
            assert.equal(g, b);
          }
      }
  assert.equal(backgroundFinish({ ...defaultMood, lightness: 0 }), 0);
  assert.equal(backgroundFinish({ ...defaultMood, lightness: 100 }), 0);
  assert.equal(themePalette({ ...defaultMood, lightness: 0 }).panel, "#000000");
  assert.equal(
    themePalette({ ...defaultMood, lightness: 100 }).panel,
    "#ffffff",
  );
});
test("dice overrides keep their color across theme changes and choose legible automatic numerals", () => {
  for (const color of ["#000000", "#ffffff", "#ff0000", "#00ff00", "#6e41a3"]) {
    const a = dicePalette(defaultMood, color),
      b = dicePalette(
        { ...defaultMood, hue: 270, saturation: 80, lightness: 90 },
        color,
      );
    assert.equal(a.color, color);
    assert.equal(b.color, color);
    assert.ok(contrast(a.color, a.fontColor) >= 4.5);
    assert.equal(
      dicePalette(defaultMood, color, "#ff77aa").fontColor,
      "#ff77aa",
    );
  }
  const dice = new TableDice(() => {});
  dice.setAppearance({ color: "#ffffff", fontColor: "#990000" });
  dice.toggle(true);
  dice.toggle(false);
  assert.equal(dice.state.color, "#ffffff");
  assert.equal(dice.state.fontColor, "#990000");
  dice.setAppearance({ color: "invalid", fontColor: null });
  assert.equal(dice.state.color, "#ffffff");
  assert.equal(dice.state.fontColor, null);
  dice.setAppearance({ color: null });
  assert.equal(dice.state.color, null);
  dice.dispose();
});
