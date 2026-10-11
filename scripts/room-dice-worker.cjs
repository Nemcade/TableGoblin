const { parentPort } = require("node:worker_threads");
const { simulateDice } = require("../.server-runtime/dice-physics.cjs");
parentPort.on("message", request => {
  try {
    const roll = simulateDice(request);
    parentPort.postMessage({ duration: (roll.frameCount - 1) / roll.fps });
  } catch { parentPort.postMessage({ error: "The dice could not be simulated. Try a smaller pool." }); }
});
