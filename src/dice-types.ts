export const diceTypes = [4, 6, 8, 10, 12, 20, 100] as const;
export type DieSides = (typeof diceTypes)[number];
export type DicePool = Partial<Record<DieSides, number>>;
export type DiceGroup = { id: string; name: string; pool: DicePool; color: string | null; fontColor: string | null };
export type DiceSetup = { color: string | null; fontColor: string | null; groups: DiceGroup[] };
export const defaultDiceGroup = (): DiceGroup => ({ id: "main", name: "Main", pool: {}, color: null, fontColor: null });
export function combinedPool(groups: DiceGroup[]): DicePool {
  const pool: DicePool = {};
  for (const group of groups) for (const sides of diceTypes) pool[sides] = (pool[sides] ?? 0) + (group.pool[sides] ?? 0);
  return pool;
}
export type DieResult = { sides: DieSides; value: number; groupId?: string; groupName?: string; color?: string | null; fontColor?: string | null };
export type RollRecord = {
  id: string;
  notation: string;
  dice: DieResult[];
  total: number;
  actorId?: string; actorName?: string; actorColor?: string;
};
export type DiceState = {
  enabled: boolean;
  sound: boolean;
  visible: boolean;
  color: string | null;
  fontColor: string | null;
  groups: DiceGroup[];
  activeGroup: string;
  pool: DicePool;
  rolling: boolean;
  result: RollRecord | null;
  history: RollRecord[];
  shared?: boolean; sharedRolling?: boolean; currentRoll?: RollRecord;
};
export function diceNotation(pool: DicePool) {
  return diceTypes
    .filter((s) => pool[s])
    .map((s) => `${pool[s]}d${s}`)
    .join(" + ");
}
export function randomDie(
  sides: number,
  draw = () => crypto.getRandomValues(new Uint32Array(1))[0],
) {
  const bound = 0x100000000 - (0x100000000 % sides);
  let n: number;
  do {
    n = draw();
  } while (n >= bound);
  return (n % sides) + 1;
}
