import type { ServerConnectOptions } from "@zcode/shared";
import { Emitter } from "@zcode/rpc";
import type {
  IRemoteBackend,
  RemoteDisconnectEvent,
  RemoteDisconnectReason,
  RemoteEnvironment,
  RemoteUploadOptions,
  StdioStream,
} from "@zcode/server/remote/backend.js";
import { normalizeRemoteArch, normalizeRemotePlatform } from "@zcode/server/remote/detectEnv.js";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";

/**
 * Server backend: 连接已经运行的 ZCode server(通过 HTTP/stdio 桥接)。
 * 对齐闭源 3.14.1 的 server RemoteTarget kind。
 *
 * 实现思路:server 是远端 zcode server 进程,通过 URL 建立 WebSocket/HTTP 连接,
 * 复用 server 自身的 RPC 协议进行文件操作和命令执行。
 */

export class ServerBackend implements IRemoteBackend {
  private readonly onDidDisconnectEmitter = new Emitter<RemoteDisconnectEvent>();
  readonly onDidDisconnect = this.onDidDisconnectEmitter.event;
  private disposed = false;

  constructor(private readonly options: ServerConnectOptions) {}

  async detect(): Promise<RemoteEnvironment> {
    // Server 环境由 zcode server 自身上报;这里返回保守默认值,
    // 实际平台/架构由 server 握手响应覆盖。
    return {
      platform: normalizeRemotePlatform(process.platform),
      arch: normalizeRemoteArch(process.arch),
    };
  }

  async upload(
    localPath: string,
    remotePath: string,
    options?: RemoteUploadOptions,
  ): Promise<void> {
    if (this.disposed) throw new Error("ServerBackend is disposed");
    // Server 模式通过 server 的 RPC 文件上传接口实现;
    // 当前为骨架,复用 server 的 workspace 文件 API。
    const stream = createReadStream(localPath);
    let uploaded = 0;
    const total = await new Promise<number>((resolve, reject) => {
      stream.on("open", () => resolve(stream.bytesRead));
      stream.on("error", reject);
    });
    await new Promise<void>((resolve, reject) => {
      stream.on("data", () => {
        uploaded += 1;
        options?.onProgress?.({ uploadedBytes: uploaded, totalBytes: total });
      });
      stream.on("end", () => resolve());
      stream.on("error", reject);
    });
  }

  async exec(command: string): Promise<StdioStream> {
    if (this.disposed) throw new Error("ServerBackend is disposed");
    // Server 模式通过 server 的 RPC 命令执行接口实现;
    // 当前为骨架,使用本地 spawn 作为占位,实际应走 server RPC。
    const child = spawn(command, { shell: true });
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      onClose: new Emitter<number>().event,
    };
  }

  async exists(_remotePath: string): Promise<boolean> {
    if (this.disposed) throw new Error("ServerBackend is disposed");
    // 骨架:实际通过 server RPC stat 接口判断
    return false;
  }

  async readFile(_remotePath: string): Promise<string> {
    if (this.disposed) throw new Error("ServerBackend is disposed");
    // 骨架:实际通过 server RPC readFile 接口读取
    return "";
  }

  dispose(): void {
    this.disposed = true;
    this.onDidDisconnectEmitter.fire({ reason: "disposed" as RemoteDisconnectReason });
    this.onDidDisconnectEmitter.dispose();
  }
}
