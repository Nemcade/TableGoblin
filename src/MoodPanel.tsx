import { defaultMood, type Mood, type MoodMotion } from "./mood";
import { NumericValue } from "./NumericValue";
import { ColorControl } from "./ColorControl";
import { PresetControl } from "./PresetControl";
import { parseMood } from "./presets";
function MoodSlider({
  label,
  name = label,
  value,
  min = 0,
  max = 100,
  suffix = "%",
  className,
  onChange,
}: {
  label: string;
  name?: string;
  value: number;
  min?: number;
  max?: number;
  suffix?: string;
  className?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="mood-control">
      {label}
      <NumericValue
        label={name}
        value={value}
        min={min}
        max={max}
        suffix={suffix}
        onChange={onChange}
      />
      <input
        className={className}
        type="range"
        step="0.1"
        min={min}
        max={max}
        value={value}
        aria-label={name}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
export function MoodPanel({
  mood,
  onChange,
}: {
  mood: Mood;
  onChange: (patch: Partial<Mood>, preview?: boolean) => void;
}) {
  const colorKey = mood.motion === "campfire" ? "campfireColor" : "canopyColor";
  return (
    <div
      className="dropdown mood-menu"
      role="group"
      aria-label="Table mood controls"
    >
      <span className="menu-heading">APPEARANCE</span>
      <PresetControl kind="Theme" value={mood} parse={parseMood} onApply={onChange} basic={{ id: "basic-green", name: "Basic green", value: defaultMood }} />
      <MoodSlider
        label="Hue"
        name="Table hue"
        value={mood.hue}
        max={360}
        suffix="°"
        className="hue-slider"
        onChange={(hue) => onChange({ hue })}
      />
      <MoodSlider
        label="Saturation"
        name="Table saturation"
        value={mood.saturation}
        onChange={(saturation) => onChange({ saturation })}
      />
      <MoodSlider
        label="Lightness"
        name="Table lightness"
        value={mood.lightness}
        onChange={(lightness) => onChange({ lightness })}
      />
      <MoodSlider
        label="Gradient"
        name="Table gradient"
        value={mood.gradient * 100}
        onChange={(gradient) => onChange({ gradient: gradient / 100 })}
      />
      <MoodSlider
        label="Texture"
        name="Table texture"
        value={mood.texture * 100}
        onChange={(texture) => onChange({ texture: texture / 100 })}
      />
      <span className="menu-heading motion-label">BACKGROUND ANIMATION</span>
      <div className="motion-choices">
        {(
          [
            ["still", "Still"],
            ["campfire", "Campfire"],
            ["canopy", "Treetops"],
          ] as [MoodMotion, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={mood.motion === value}
            onClick={() => onChange({ motion: value })}
          >
            {label}
          </button>
        ))}
      </div>
      {mood.motion !== "still" && (
        <>
          <ColorControl
            label="Effect color"
            value={mood[colorKey]}
            onChange={(color, preview) => onChange({ [colorKey]: color }, preview)}
            onReset={() => onChange({ [colorKey]: defaultMood[colorKey] })}
            resetLabel="Reset effect color"
          />
          <MoodSlider
            label="Intensity"
            name="Animation strength"
            value={mood.amount * 100}
            max={400}
            onChange={(amount) => onChange({ amount: amount / 100 })}
          />
          <MoodSlider
            label="Spread"
            name="Animation spread"
            value={mood.spread * 100}
            min={25}
            max={200}
            onChange={(spread) => onChange({ spread: spread / 100 })}
          />
          <MoodSlider
            label={mood.motion === "campfire" ? "Flicker" : "Sway"}
            name="Animation variation"
            value={mood.variation * 100}
            max={200}
            onChange={(variation) => onChange({ variation: variation / 100 })}
          />
          <MoodSlider
            label="Pace"
            name="Animation pace"
            value={mood.speed * 100}
            max={200}
            onChange={(speed) => onChange({ speed: speed / 100 })}
          />
        </>
      )}
    </div>
  );
}
