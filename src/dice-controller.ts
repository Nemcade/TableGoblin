import type { Camera } from "./render";
import { defaultMood, type Mood } from "./mood.ts";
import { DiceSound } from "./dice-sound.ts";
import { dicePalette } from "./dice-style.ts";
import { hslHex, isHexColor, withAlpha } from "./colors.ts";
import {
  diceTypes,
  diceNotation,
  randomDie,
  defaultDiceGroup,
  combinedPool,
  type DiceSetup,
  type DieResult,
  type DiceState,
  type DieSides,
  type RollRecord,
} from "./dice-types.ts";
import { dieMesh, turn, type Mesh, type Q, type V3 } from "./dice-geometry.ts";
import {
  simulateDice,
  type PhysicsRequest,
  type PhysicsRoll,
} from "./dice-physics.ts";
type Body = {
  groupId: string;
  color: string | null;
  fontColor: string | null;
  mesh: Mesh;
  sides: number;
  labels: string[];
  resultFace: number;
  position: V3;
  q: Q;
  size: number;
};
const normalize = (q: Q): Q => {
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const between = (low: number, high: number) => lerp(low, high, Math.random());
const quaternion = (): Q => {
  const a = Math.random(),
    b = Math.random() * Math.PI * 2,
    c = Math.random() * Math.PI * 2;
  return {
    x: Math.sqrt(1 - a) * Math.sin(b),
    y: Math.sqrt(1 - a) * Math.cos(b),
    z: Math.sqrt(a) * Math.sin(c),
    w: Math.sqrt(a) * Math.cos(c),
  };
};
export class TableDice {
  state: DiceState = {
    enabled: false,
    sound: true,
    visible: false,
    color: null,
    fontColor: null,
    groups: [defaultDiceGroup()],
    activeGroup: "main",
    pool: {},
    rolling: false,
    result: null,
    history: [],
  };
  private bodies: Body[] = [];
  private worker: Worker | null = null;
  private frames: PhysicsRoll | null = null;
  private pending: RollRecord | null = null;
  private start = 0;
  private launch: Camera = { x: 0, y: 0, zoom: 1 };
  private changed: (save?: boolean) => void;
  private generation = 0;
  private sound = new DiceSound();
  private settledAt: number | null = null;
  private opacity = 1;
  private impactIndex = 0;
  constructor(changed: (save?: boolean) => void) {
    this.changed = changed;
  }
  toggle(enabled: boolean) {
    this.state = {
      ...this.state,
      enabled,
      rolling: enabled && this.state.rolling,
    };
    if (!enabled) {
      this.cancel();
      this.sound.release();
    }
    this.changed();
  }
  setSound(enabled: boolean) {
    this.state = { ...this.state, sound: enabled };
    this.sound.setEnabled(enabled);
    if (enabled && this.state.rolling) this.sound.prepare();
    this.changed();
  }
  setAppearance(patch: { color?: string | null; fontColor?: string | null }, preview = false) {
    const next = { ...this.state };
    const group = { ...next.groups.find((g) => g.id === next.activeGroup)! };
    for (const key of ["color", "fontColor"] as const) {
      const value = patch[key];
      if (value === null || (typeof value === "string" && isHexColor(value))) {
        if (group.id === "main") next[key] = value;
        else group[key] = value;
      }
    }
    next.groups = next.groups.map((g) => g.id === group.id ? group : g);
    this.state = next;
    this.changed(!preview);
  }
  selectGroup(id: string) {
    if (!this.state.groups.some((g) => g.id === id)) return;
    this.state = { ...this.state, activeGroup: id };
    this.changed();
  }
  addGroup() {
    if (this.state.rolling || this.state.groups.length >= 6) return;
    const id = crypto.randomUUID(), colors = ["#b86a5d", "#6094bc", "#c6a95f", "#9e78ba", "#71ab90"];
    const group = { ...defaultDiceGroup(), id, name: `Group ${this.state.groups.length + 1}`, color: colors[(this.state.groups.length - 1) % colors.length] };
    this.state = { ...this.state, groups: [...this.state.groups, group], activeGroup: id };
    this.changed();
  }
  renameGroup(name: string) {
    this.state = { ...this.state, groups: this.state.groups.map((g) => g.id === this.state.activeGroup ? { ...g, name: name.slice(0, 24) } : g) };
    this.changed();
  }
  removeGroup() {
    if (this.state.rolling || this.state.activeGroup === "main") return;
    const groups = this.state.groups.filter((g) => g.id !== this.state.activeGroup);
    this.state = { ...this.state, groups, pool: combinedPool(groups), activeGroup: "main" };
    this.changed();
  }
  setup(): DiceSetup {
    return structuredClone({ color: this.state.color, fontColor: this.state.fontColor, groups: this.state.groups });
  }
  applySetup(setup: DiceSetup) {
    if (this.state.rolling) return;
    this.cancel();
    const copy = structuredClone(setup);
    this.state = { ...this.state, ...copy, pool: combinedPool(copy.groups), activeGroup: "main" };
    this.changed();
  }
  private cancel() {
    this.generation++;
    this.worker?.terminate();
    this.worker = null;
    this.bodies = [];
    this.frames = null;
    this.pending = null;
    this.settledAt = null;
    this.opacity = 1;
    this.impactIndex = 0;
    this.state = { ...this.state, visible: false };
    this.sound.stop();
  }
  dispose() {
    this.cancel();
    this.sound.dispose();
  }
  choose(sides: DieSides, remove = false) {
    if (this.state.rolling) return;
    const group = this.state.groups.find((g) => g.id === this.state.activeGroup)!,
      pool = { ...group.pool },
      count = Object.values(this.state.pool).reduce((sum, n) => sum + (n ?? 0), 0);
    if (!remove && count >= 20) return;
    pool[sides] = Math.max(0, (pool[sides] ?? 0) + (remove ? -1 : 1));
    const groups = this.state.groups.map((g) => g.id === group.id ? { ...g, pool } : g);
    this.state = { ...this.state, groups, pool: combinedPool(groups) };
    this.changed();
  }
  clearPool() {
    if (this.state.rolling) return;
    this.state = { ...this.state, pool: {}, groups: this.state.groups.map((g) => ({ ...g, pool: {} })) };
    this.changed();
  }
  clearTable() {
    if (this.state.rolling) return;
    this.cancel();
    this.changed();
  }
  roll(camera: Camera, width: number, height: number, mood: Mood = defaultMood) {
    if (
      !this.state.enabled ||
      this.state.rolling ||
      !diceNotation(this.state.pool)
    )
      return;
    this.cancel();
    // Resume during the Roll button's user gesture, before the worker returns.
    this.sound.prepare();
    this.launch = { ...camera };
    const dice = this.state.groups.flatMap((group) => {
      const palette = dicePalette(mood, group.color ?? this.state.color, group.fontColor ?? this.state.fontColor);
      return diceTypes.flatMap((sides) =>
        Array.from({ length: group.pool[sides] ?? 0 }, () => ({
          sides,
          value: randomDie(sides),
          groupId: group.id,
          groupName: group.name.trim() || "Group",
          color: palette.color,
          fontColor: palette.fontColor,
        })),
      );
    });
    this.pending = {
      id: crypto.randomUUID(),
      notation: diceNotation(this.state.pool),
      dice,
      total: dice.reduce((sum, d) => sum + d.value, 0),
    };
    this.state = { ...this.state, rolling: true, result: null };
    this.changed();
    const bounds = {
      left: 25 / 64,
      right: (width > 700 ? width - 330 : width - 25) / 64,
      top: 100 / 64,
      bottom: Math.max(260, height - 145) / 64,
    };
    const heading = between(0, Math.PI * 2),
      direction = { x: Math.cos(heading), y: Math.sin(heading) };
    const origin = {
      x:
        (bounds.left + bounds.right) / 2 -
        direction.x * (bounds.right - bounds.left) * 0.12,
      y:
        (bounds.top + bounds.bottom) / 2 -
        direction.y * (bounds.bottom - bounds.top) * 0.12,
    };
    const specs: PhysicsRequest["specs"] = [],
      desired: number[] = [];
    const count = dice.reduce((n, d) => n + (d.sides === 100 ? 2 : 1), 0),
      columns = Math.ceil(
        Math.sqrt(
          (count * (bounds.right - bounds.left)) / (bounds.bottom - bounds.top),
        ),
      ),
      rows = Math.ceil(count / columns),
      gapX = Math.min(
        1.15,
        (bounds.right - bounds.left - 1.4) / Math.max(1, columns - 1),
      ),
      gapY = Math.min(
        1.15,
        (bounds.bottom - bounds.top - 1.4) / Math.max(1, rows - 1),
      );
    const create = (sides: number, value: number, labels: string[], die: DieResult) => {
      const radius = between(0.47, 0.53),
        speed = between(2.1, 4.8),
        spread = between(-0.8, 0.8),
        order = specs.length;
      const position = {
        x: Math.max(
          bounds.left + 0.65,
          Math.min(
            bounds.right - 0.65,
            origin.x +
            ((order % columns) - (columns - 1) / 2) * gapX +
            between(-0.08, 0.08),
          ),
        ),
        y: Math.max(
          bounds.top + 0.65,
          Math.min(
            bounds.bottom - 0.65,
            origin.y +
            (Math.floor(order / columns) - (rows - 1) / 2) * gapY +
            between(-0.08, 0.08),
          ),
        ),
        z: between(2, 3.7),
      };
      specs.push({
        sides,
        radius,
        position,
        velocity: {
          x: direction.x * speed - direction.y * spread,
          y: direction.y * speed + direction.x * spread,
          z: between(-0.2, 2.8),
        },
        spin: { x: between(-17, 17), y: between(-17, 17), z: between(-12, 12) },
        q: quaternion(),
        damping: between(0.12, 0.26),
      });
      desired.push(value);
      this.bodies.push({
        groupId: die.groupId!,
        color: die.color ?? null,
        fontColor: die.fontColor ?? null,
        mesh: dieMesh(sides),
        sides,
        labels,
        resultFace: 0,
        position: { x: 0, y: 0, z: 0 },
        q: specs.at(-1)!.q,
        size: (radius * 64) / camera.zoom,
      });
    };
    for (const die of dice)
      if (die.sides === 100) {
        const n = die.value % 100;
        create(
          10,
          Math.floor(n / 10),
          Array.from({ length: 10 }, (_, i) => String(i * 10).padStart(2, "0")),
          die,
        );
        create(
          10,
          n % 10,
          Array.from({ length: 10 }, (_, i) => String(i)),
          die,
        );
      } else
        create(
          die.sides,
          die.value - 1,
          Array.from({ length: die.sides }, (_, i) => String(i + 1)),
          die,
        );
    const request: PhysicsRequest = {
      specs,
      bounds,
      seed: crypto.getRandomValues(new Uint32Array(1))[0],
    },
      generation = this.generation;
    const ready = (roll: PhysicsRoll) => {
      if (generation !== this.generation || !this.state.enabled) return;
      this.bodies.forEach((b, i) => {
        b.resultFace = roll.resultFaces[i];
        const labels = [...b.labels],
          from = desired[i];
        [labels[b.resultFace], labels[from]] = [
          labels[from],
          labels[b.resultFace],
        ];
        b.labels = labels;
      });
      this.frames = roll;
      this.start = performance.now();
      this.state = { ...this.state, visible: true };
      this.pose(0);
      this.changed();
    };
    // Simulate off the UI thread; replay the physical trajectory without a forced settling animation.
    if (typeof Worker !== "undefined" && import.meta.url) {
      try {
        this.worker = new Worker(new URL("./dice.worker.ts", import.meta.url), {
          type: "module",
        });
        this.worker.onmessage = (event) => {
          this.worker?.terminate();
          this.worker = null;
          ready(event.data as PhysicsRoll);
        };
        this.worker.onerror = () => {
          this.worker?.terminate();
          this.worker = null;
          if (generation === this.generation) ready(simulateDice(request));
        };
        this.worker.postMessage(request);
      } catch {
        ready(simulateDice(request));
      }
    } else ready(simulateDice(request));
  }
  private pose(frame: number) {
    const roll = this.frames;
    if (!roll) return;
    const a = Math.floor(frame),
      b = Math.min(a + 1, roll.frameCount - 1),
      t = frame - a,
      scale = 64 / this.launch.zoom;
    this.bodies.forEach((body, i) => {
      const ai = (a * roll.count + i) * 7,
        bi = (b * roll.count + i) * 7;
      body.position = {
        x:
          lerp(roll.frames[ai], roll.frames[bi], t) * scale -
          this.launch.x / this.launch.zoom,
        y:
          lerp(roll.frames[ai + 1], roll.frames[bi + 1], t) * scale -
          this.launch.y / this.launch.zoom,
        z: lerp(roll.frames[ai + 2], roll.frames[bi + 2], t) * scale,
      };
      const qa = {
        x: roll.frames[ai + 3],
        y: roll.frames[ai + 4],
        z: roll.frames[ai + 5],
        w: roll.frames[ai + 6],
      },
        qb = {
          x: roll.frames[bi + 3],
          y: roll.frames[bi + 4],
          z: roll.frames[bi + 5],
          w: roll.frames[bi + 6],
        },
        sign =
          qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w < 0 ? -1 : 1;
      body.q = normalize({
        x: lerp(qa.x, qb.x * sign, t),
        y: lerp(qa.y, qb.y * sign, t),
        z: lerp(qa.z, qb.z * sign, t),
        w: lerp(qa.w, qb.w * sign, t),
      });
    });
  }
  step(now: number, camera: Camera, width: number, _height: number) {
    if (!this.frames) return false;
    if (!this.state.rolling) {
      if (this.settledAt === null || now < this.settledAt + 4000) return false;
      const fade = Math.min(1, (now - this.settledAt - 4000) / 900);
      this.opacity = 1 - fade * fade * (3 - 2 * fade);
      if (fade === 1) this.clearTable();
      return true;
    }
    const age = Math.max(0, (now - this.start) / 1000);
    const frame = Math.min(this.frames.frameCount - 1, age * this.frames.fps);
    this.pose(frame);
    while (
      this.impactIndex < this.frames.impacts.length &&
      this.frames.impacts[this.impactIndex].time <= age
    ) {
      const impact = this.frames.impacts[this.impactIndex++];
      // Consume skipped events silently after an inactive tab or a stalled frame.
      if (age - impact.time > 0.1) continue;
      const screenX =
        ((impact.x * 64 - this.launch.x) / this.launch.zoom) * camera.zoom +
        camera.x;
      this.sound.play(impact, (screenX / Math.max(1, width)) * 1.5 - 0.75);
    }
    if (frame === this.frames.frameCount - 1 && this.pending) {
      const record = this.pending;
      this.pending = null;
      this.settledAt = now;
      this.state = {
        ...this.state,
        rolling: false,
        result: record,
        history: [record, ...this.state.history].slice(0, 12),
      };
      this.changed();
    }
    return true;
  }
  draw(ctx: CanvasRenderingContext2D, camera: Camera, mood: Mood) {
    if (!this.state.enabled || !this.frames) return;
    ctx.save();
    ctx.globalAlpha *= this.opacity;
    for (const b of [...this.bodies].sort(
      (a, b) => a.position.z - b.position.z,
    )) {
      const group = this.state.groups.find((g) => g.id === b.groupId);
      const palette = dicePalette(mood, group ? group.color ?? this.state.color : b.color, group ? group.fontColor ?? this.state.fontColor : b.fontColor);
      const x = b.position.x * camera.zoom + camera.x,
        y = b.position.y * camera.zoom + camera.y,
        base = b.size * camera.zoom;
      const vertices = b.mesh.vertices.map((v) => turn(v, b.q)),
        support = Math.max(...vertices.map((v) => -v.z)) * b.size,
        altitude = Math.max(0, (b.position.z - support) / b.size),
        size = base * (1 + Math.min(0.22, altitude * 0.035));
      const screen = (v: V3) => ({ x: x + v.x * size, y: y + v.y * size });
      ctx.beginPath();
      ctx.ellipse(
        x + altitude * 1.5,
        y + altitude * 2,
        base * (0.9 + altitude * 0.055),
        base * (0.88 + altitude * 0.055),
        0,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = `rgba(0,0,0,${0.26 / (1 + altitude * 0.2)})`;
      ctx.filter = `blur(${2 + Math.min(10, altitude * 1.6)}px)`;
      ctx.fill();
      ctx.filter = "none";
      const faces = b.mesh.faces
        .map((face, index) => ({
          face,
          index,
          normal: turn(face.normal, b.q),
          center: turn(face.center, b.q),
        }))
        .filter((f) => f.normal.z > 0.015)
        .sort((a, b) => a.center.z - b.center.z);
      for (const { face, index, normal, center } of faces) {
        ctx.beginPath();
        face.indices.forEach((i, j) => {
          const p = screen(vertices[i]);
          if (!j) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        const light = Math.max(
          0,
          normal.z * 0.85 - normal.x * 0.3 - normal.y * 0.2,
        );
        ctx.fillStyle = hslHex(
          palette.h,
          palette.s,
          palette.l + (light - 0.85) * 31,
        );
        ctx.strokeStyle = withAlpha(palette.edge, 0.45);
        ctx.lineWidth = 0.75;
        ctx.lineJoin = "round";
        ctx.fill();
        ctx.stroke();
        ctx.save();
        ctx.clip();
        const a = b.mesh.vertices[face.indices[0]],
          d = b.mesh.vertices[face.indices[1]],
          l = Math.hypot(d.x - a.x, d.y - a.y, d.z - a.z),
          localU = {
            x: (d.x - a.x) / l,
            y: (d.y - a.y) / l,
            z: (d.z - a.z) / l,
          },
          localV = {
            x: face.normal.y * localU.z - face.normal.z * localU.y,
            y: face.normal.z * localU.x - face.normal.x * localU.z,
            z: face.normal.x * localU.y - face.normal.y * localU.x,
          },
          u = turn(localU, b.q),
          v = turn(localV, b.q),
          p = screen(center);
        const isResult = b.sides === 4 || index === b.resultFace;
        const font =
          size *
          (b.sides === 20
            ? 0.36
            : b.sides === 10
              ? 0.42
              : b.sides === 12
                ? 0.49
                : b.sides === 4
                  ? 0.54
                  : 0.59) *
          (isResult ? 1.08 : 1);
        ctx.translate(p.x, p.y);
        ctx.transform(u.x, u.y, v.x, v.y, 0, 0);
        ctx.font = `600 ${font}px "Palatino Linotype","Book Antiqua",Georgia,serif`;
        ctx.fillStyle = withAlpha(palette.fontColor, isResult ? 1 : 0.5);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const numeral = b.labels[b.sides === 4 ? b.resultFace : index];
        ctx.fillText(numeral, 0, 0);
        if (numeral === "6" || numeral === "9") {
          ctx.beginPath();
          ctx.moveTo(-font * 0.18, font * 0.53);
          ctx.lineTo(font * 0.18, font * 0.53);
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = Math.max(0.7, font * 0.06);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }
}
