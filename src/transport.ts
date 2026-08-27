import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";
import type { AgentPetConfig } from "./config.js";

export type AgentPetEventName = "registered" | "working" | "waiting" | "done" | "idle";
export type DeliveryResult = "socket" | "queued" | "failed";
export type SocketStatus = "reachable" | "unreachable";

export interface AgentPetEvent {
  sessionId: string;
  agentKind: "pi";
  eventName: AgentPetEventName;
  project?: string;
  message?: string;
  model?: string;
  toolName?: string;
  toolSummary?: string;
  timestamp: number;
}

export interface TransportStatus {
  socketPath: string;
  socket: SocketStatus;
  queueDir: string;
  queueEntries: number;
}

let sequence = 0;

export class AgentPetTransport {
  private tail: Promise<void> = Promise.resolve();

  public constructor(private readonly config: AgentPetConfig) {}

  public async send(event: AgentPetEvent): Promise<void> {
    await this.deliver(event);
  }

  public async status(): Promise<TransportStatus> {
    const socket = await this.enqueue(async () => {
      try {
        await this.probeSocket();
        return "reachable" as const;
      } catch {
        return "unreachable" as const;
      }
    });
    let queueEntries = 0;
    try {
      await this.assertQueueDirectory(false);
      queueEntries = (await readdir(this.config.queueDir)).filter((name) => name.endsWith(".json")).length;
    } catch {
      // A missing or unsafe queue is reported as empty and never trusted.
    }
    return { socketPath: this.config.socketPath, socket, queueDir: this.config.queueDir, queueEntries };
  }

  public async test(event: AgentPetEvent): Promise<DeliveryResult> {
    return this.deliver(event);
  }

  private deliver(event: AgentPetEvent): Promise<DeliveryResult> {
    const payload = `${JSON.stringify(event)}\n`;
    return this.enqueue(async () => {
      try {
        await this.writeSocket(payload);
        return "socket";
      } catch {
        try {
          await this.queue(payload);
          return "queued";
        } catch {
          return "failed";
        }
      }
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async assertSocketPath(): Promise<void> {
    const details = await lstat(this.config.socketPath);
    if (!details.isSocket() || details.uid !== process.getuid?.()) {
      throw new Error("AgentPet socket must be owned by the current user");
    }
  }

  private writeSocket(payload: string): Promise<void> {
    return new Promise((resolve, reject) => {
      void this.assertSocketPath().then(() => {
        const socket = connect(this.config.socketPath);
        let settled = false;
        const finish = (error?: Error): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          error ? reject(error) : resolve();
        };
        const timer = setTimeout(() => finish(new Error("AgentPet socket timeout")), this.config.timeoutMs);
        socket.once("error", finish);
        socket.once("connect", () => socket.write(payload, (error) => finish(error || undefined)));
      }, reject);
    });
  }

  private probeSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      void this.assertSocketPath().then(() => {
        const socket = connect(this.config.socketPath);
        let settled = false;
        const finish = (error?: Error): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          error ? reject(error) : resolve();
        };
        const timer = setTimeout(() => finish(new Error("AgentPet socket timeout")), this.config.timeoutMs);
        socket.once("error", finish);
        socket.once("connect", () => finish());
      }, reject);
    });
  }

  private async assertQueueDirectory(create: boolean): Promise<void> {
    if (create) await mkdir(this.config.queueDir, { recursive: true, mode: 0o700 });
    const details = await lstat(this.config.queueDir);
    if (!details.isDirectory() || details.isSymbolicLink() || details.uid !== process.getuid?.()) {
      throw new Error("AgentPet queue must be a directory owned by the current user");
    }
    await chmod(this.config.queueDir, 0o700);
  }

  private async queue(payload: string): Promise<void> {
    await this.assertQueueDirectory(true);
    await this.trimQueue();
    const stamp = String(Date.now()).padStart(13, "0");
    const name = `${stamp}-${process.pid}-${String(sequence++).padStart(6, "0")}-${randomUUID()}.json`;
    const destination = join(this.config.queueDir, name);
    const temporary = join(this.config.queueDir, `.${name}.tmp`);
    await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, destination);
    await chmod(destination, 0o600);
  }

  private async trimQueue(): Promise<void> {
    const names = (await readdir(this.config.queueDir)).filter((name) => name.endsWith(".json")).sort();
    const removeCount = Math.max(0, names.length - this.config.queueMaxEntries + 1);
    for (const name of names.slice(0, removeCount)) {
      const path = join(this.config.queueDir, name);
      try {
        if ((await lstat(path)).isFile()) await rm(path, { force: true });
      } catch {
        // A stale entry cannot make reporting fail.
      }
    }
  }
}
