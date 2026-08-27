import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentPetTransport } from "../src/transport.js";

const event = {
  sessionId: "test-session",
  agentKind: "pi" as const,
  eventName: "working" as const,
  project: "demo",
  message: "Thinking",
  timestamp: 1,
};

async function listen(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("transport writes one LF-delimited event to a current-user AgentPet socket", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-agent-pet-"));
  const socketPath = join(directory, "agentpet.sock");
  let resolveReceived: (value: string) => void = () => undefined;
  const received = new Promise<string>((resolve) => { resolveReceived = resolve; });
  const server = createServer((socket) => {
    let data = "";
    socket.on("data", (chunk) => { data += chunk.toString("utf8"); });
    socket.on("end", () => resolveReceived(data));
  });
  await listen(server, socketPath);
  t.after(async () => { await close(server); await rm(directory, { recursive: true, force: true }); });
  const transport = new AgentPetTransport({ socketPath, queueDir: join(directory, "queue"), timeoutMs: 100, queueMaxEntries: 2 });
  await transport.send(event);
  assert.equal(await received, `${JSON.stringify(event)}\n`);
});

test("transport serializes concurrent fallback writes and keeps the queue bounded", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-agent-pet-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const queueDir = join(directory, "queue");
  const transport = new AgentPetTransport({ socketPath: join(directory, "missing.sock"), queueDir, timeoutMs: 20, queueMaxEntries: 2 });
  await Promise.all(Array.from({ length: 20 }, (_, timestamp) => transport.send({ ...event, timestamp })));
  const files = (await readdir(queueDir)).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 2);
  const payload = await readFile(join(queueDir, files[0]), "utf8");
  assert.match(payload, /\n$/);
  const queueStats = await stat(queueDir);
  assert.equal(queueStats.mode & 0o777, 0o700);
  assert.equal((await stat(join(queueDir, files[0]))).mode & 0o777, 0o600);
});

test("transport reports failed queue writes without blocking its later tail", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-agent-pet-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const queuePath = join(directory, "queue-file");
  const socketPath = join(directory, "agentpet.sock");
  await writeFile(queuePath, "not a directory");
  const transport = new AgentPetTransport({ socketPath, queueDir: queuePath, timeoutMs: 20, queueMaxEntries: 2 });
  assert.equal(await transport.test(event), "failed");

  await rm(queuePath);
  const server = createServer((socket) => { socket.on("data", () => socket.end()); });
  await listen(server, socketPath);
  t.after(async () => close(server));
  assert.equal(await transport.test({ ...event, timestamp: 2 }), "socket");
});

test("transport rejects symlinked queue directories and socket paths", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-agent-pet-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const targetQueue = join(directory, "target-queue");
  const queueLink = join(directory, "queue-link");
  await symlink(targetQueue, queueLink);
  const queueTransport = new AgentPetTransport({ socketPath: join(directory, "missing.sock"), queueDir: queueLink, timeoutMs: 20, queueMaxEntries: 2 });
  assert.equal(await queueTransport.test(event), "failed");

  const targetSocket = join(directory, "target.sock");
  const socketLink = join(directory, "socket-link");
  const server = createServer();
  await listen(server, targetSocket);
  t.after(async () => close(server));
  await symlink(targetSocket, socketLink);
  const socketTransport = new AgentPetTransport({ socketPath: socketLink, queueDir: join(directory, "queue"), timeoutMs: 100, queueMaxEntries: 2 });
  assert.equal(await socketTransport.test(event), "queued");
});
