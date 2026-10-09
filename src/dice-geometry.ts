export type V3 = { x: number; y: number; z: number };
export type Q = { x: number; y: number; z: number; w: number };
export type Face = { indices: number[]; normal: V3; center: V3 };
export type Mesh = { vertices: V3[]; faces: Face[] };
const add = (a: V3, b: V3): V3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});
const sub = (a: V3, b: V3): V3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const mul = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const length = (a: V3) => Math.hypot(a.x, a.y, a.z);
const norm = (a: V3) => mul(a, 1 / (length(a) || 1));
export const turn = (v: V3, q: Q): V3 => {
  const u = { x: q.x, y: q.y, z: q.z },
    t = mul(cross(u, v), 2);
  return add(v, add(mul(t, q.w), cross(u, t)));
};
/** Outward planar faces, including polygonal faces of cubes, d12s, and d10s. */
export function convexMesh(input: V3[]): Mesh {
  const radius = Math.max(...input.map(length)),
    vertices = input.map((v) => mul(v, 1 / radius)),
    faces: Face[] = [],
    seen = new Set<string>();
  for (let a = 0; a < vertices.length; a++)
    for (let b = a + 1; b < vertices.length; b++)
      for (let c = b + 1; c < vertices.length; c++) {
        let normal = norm(
          cross(sub(vertices[b], vertices[a]), sub(vertices[c], vertices[a])),
        );
        if (length(normal) < 0.5) continue;
        const d = dot(normal, vertices[a]),
          distances = vertices.map((v) => dot(normal, v) - d);
        if (distances.some((x) => x > 1e-6) && distances.some((x) => x < -1e-6))
          continue;
        if (distances.some((x) => x > 1e-6)) normal = mul(normal, -1);
        const indices = distances.flatMap((d, i) =>
            Math.abs(d) < 1e-6 ? [i] : [],
          ),
          key = indices.join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        const center = mul(
            indices.reduce((v, i) => add(v, vertices[i]), { x: 0, y: 0, z: 0 }),
            1 / indices.length,
          ),
          u = norm(sub(vertices[indices[0]], center)),
          v = cross(normal, u);
        indices.sort(
          (a, b) =>
            Math.atan2(
              dot(sub(vertices[a], center), v),
              dot(sub(vertices[a], center), u),
            ) -
            Math.atan2(
              dot(sub(vertices[b], center), v),
              dot(sub(vertices[b], center), u),
            ),
        );
        faces.push({ indices, normal, center });
      }
  return { vertices, faces };
}
const meshes = new Map<number, Mesh>();
export function dieMesh(sides: number): Mesh {
  const cached = meshes.get(sides);
  if (cached) return cached;
  let vertices: V3[] = [];
  if (sides === 4)
    vertices = [
      { x: 1, y: 1, z: 1 },
      { x: 1, y: -1, z: -1 },
      { x: -1, y: 1, z: -1 },
      { x: -1, y: -1, z: 1 },
    ];
  else if (sides === 6)
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        for (const z of [-1, 1]) vertices.push({ x, y, z });
  else if (sides === 8)
    vertices = [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
    ];
  else if (sides === 10 || sides === 100) {
    for (let i = 0; i < 5; i++)
      for (const sign of [-1, 1]) {
        const a = (i * Math.PI * 2) / 5 + (sign < 0 ? Math.PI / 5 : 0);
        vertices.push({ x: Math.cos(a), y: Math.sin(a), z: sign * 0.55 });
      }
    const primal = convexMesh(vertices);
    vertices = primal.faces.map((f) =>
      mul(f.normal, 1 / dot(f.normal, primal.vertices[f.indices[0]])),
    );
  } else {
    const phi = (1 + Math.sqrt(5)) / 2;
    for (const a of [-1, 1])
      for (const b of [-phi, phi])
        vertices.push(
          { x: 0, y: a, z: b },
          { x: a, y: b, z: 0 },
          { x: b, y: 0, z: a },
        );
    if (sides === 12) {
      const primal = convexMesh(vertices);
      vertices = primal.faces.map((f) => f.center);
    }
  }
  const mesh = convexMesh(vertices);
  meshes.set(sides, mesh);
  return mesh;
}
