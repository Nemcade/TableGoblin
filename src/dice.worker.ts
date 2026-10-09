import { simulateDice, type PhysicsRequest } from "./dice-physics";
const worker = self as unknown as {
  onmessage: ((event: MessageEvent<PhysicsRequest>) => void) | null;
  postMessage: (message: unknown, transfer: Transferable[]) => void;
};
worker.onmessage = (event) => {
  const roll = simulateDice(event.data);
  worker.postMessage(roll, [roll.frames.buffer]);
};
