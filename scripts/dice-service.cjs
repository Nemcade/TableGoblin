const { Worker } = require("node:worker_threads");
const path = require("node:path");
const slots = [{ worker: null, job: null }, { worker: null, job: null }], queue = [];
let stopped = false;
function pump(slot) {
  if (stopped || slot.job || !queue.length) return;
  if (!slot.worker) {
    const worker = new Worker(path.join(__dirname, "room-dice-worker.cjs")); slot.worker = worker;
    worker.on("message", result => {
      const job = slot.job; if (!job) return;
      clearTimeout(job.timer); slot.job = null;
      if (result.error) job.reject(new Error(result.error)); else job.resolve(result);
      pump(slot);
    });
    const failed = () => {
      if (slot.worker !== worker) return;
      slot.worker = null;
      if (slot.job) { clearTimeout(slot.job.timer); slot.job.reject(new Error("Dice simulation was interrupted. Try again.")); slot.job = null; }
      void worker.terminate(); pump(slot);
    };
    worker.on("error", failed); worker.on("exit", failed);
  }
  const job = queue.shift(); slot.job = job;
  job.timer = setTimeout(() => {
    const worker = slot.worker; slot.worker = null; slot.job = null;
    job.reject(new Error("Dice simulation timed out. Try a smaller pool.")); void worker.terminate(); pump(slot);
  }, 10000);
  slot.worker.postMessage(job.request);
}
exports.simulate = request => new Promise((resolve, reject) => {
  if (stopped || queue.length + slots.filter(s => s.job).length >= 16) { reject(new Error("The dice service is busy. Try again shortly.")); return; }
  queue.push({ request, resolve, reject }); slots.forEach(pump);
});
exports.stop = () => {
  stopped = true;
  for (const job of queue.splice(0)) job.reject(new Error("Room server stopped."));
  for (const slot of slots) { if (slot.job) { clearTimeout(slot.job.timer); slot.job.reject(new Error("Room server stopped.")); slot.job = null; } void slot.worker?.terminate(); slot.worker = null; }
};
