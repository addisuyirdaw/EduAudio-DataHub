/**
 * server/services/datahubMcpClient.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Minimal, dependency-free Model Context Protocol (MCP) client for the
 * DataHub MCP Server (github.com/acryldata/mcp-server-datahub).
 *
 * Speaks JSON-RPC 2.0 over two transports:
 *   1. stdio  — spawns the DataHub MCP server process (e.g. `uvx
 *               mcp-server-datahub@latest`) and talks newline-delimited
 *               JSON-RPC on stdin/stdout.
 *   2. HTTP   — best-effort streamable HTTP transport: JSON-RPC POSTs with
 *               session-id handling and SSE response parsing.
 *
 * Only the tools needed by EduAudio are exercised:
 *   - search_documents / grep_documents  (context/metadata reads)
 *   - get_entities / list_schema_fields  (schema & detail reads)
 *   - save_document / update_description (telemetry & knowledge write-backs)
 *
 * Every failure throws a descriptive Error so the caller can fall back to
 * the GraphQL relay and finally to local mock data without breaking the app.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

export interface McpClientOptions {
  /** stdio transport: executable to spawn (e.g. `uvx`, `python`) */
  command?: string;
  /** stdio transport: arguments for the executable */
  args?: string[];
  /** HTTP transport: streamable HTTP / SSE endpoint URL (takes precedence) */
  url?: string;
  /** HTTP transport: optional bearer token */
  token?: string;
  /** env vars forwarded to the spawned MCP server process */
  serverEnv?: Record<string, string>;
  /** per-request timeout in ms (default 10_000) */
  timeoutMs?: number;
}

export interface McpToolInfo {
  name: string;
  description?: string;
}

export interface McpCallResult {
  toolName: string;
  /** concatenated `content[].text` blocks returned by the tool */
  text: string;
  isError: boolean;
}

interface JsonRpcResponse {
  id: number;
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
    [key: string]: unknown;
  };
  error?: { code: number; message: string; data?: unknown };
}

const DEFAULT_TIMEOUT_MS = 10_000;

function log(message: string): void {
  console.log(`[DataHubMcp] ${message}`);
}

function warn(message: string, error?: unknown): void {
  console.warn(`[DataHubMcp] ${message}`, error ?? '');
}

/**
 * DataHubMcpClient — JSON-RPC 2.0 client for the DataHub MCP Server.
 */
export class DataHubMcpClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = '';
  private pending = new Map<
    number,
    {
      resolve: (value: JsonRpcResponse) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private nextId = 1;
  private sessionId: string | null = null;
  private connected = false;
  private readonly timeoutMs: number;

  constructor(private readonly options: McpClientOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** True when either a stdio command or an HTTP endpoint was configured. */
  get isConfigured(): boolean {
    return Boolean(this.options.command || this.options.url);
  }

  /** Human-readable transport label for diagnostics. */
  get transportLabel(): string {
    return this.options.url
      ? `http (${this.options.url})`
      : `stdio (${this.options.command} ${(this.options.args ?? []).join(' ')})`;
  }

  /**
   * Establishes the MCP session (spawns the process or prepares HTTP) and
   * runs the `initialize` handshake required by the MCP specification.
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    if (this.options.url) {
      log(`MCP Server path ACTIVE (http transport: ${this.options.url})`);
      await this.initialize();
      this.connected = true;
      return;
    }

    if (!this.options.command) {
      throw new Error('No DATAHUB_MCP_COMMAND or DATAHUB_MCP_URL configured.');
    }

    await this.spawnChild();
    await this.initialize();
    this.connected = true;
    log(`MCP Server path ACTIVE (${this.transportLabel})`);
  }

  /**
   * Lists the tools advertised by the MCP server. Used for diagnostics so
   * the logs make it obvious which DataHub MCP tools are available.
   */
  async listTools(): Promise<McpToolInfo[]> {
    const res = await this.request('tools/list', {});
    const tools = (res.result?.tools as McpToolInfo[] | undefined) ?? [];
    log(`MCP server advertises ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);
    return tools;
  }

  /**
   * Invokes a DataHub MCP tool and returns the extracted text payload.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    if (!this.connected) await this.connect();
    log(`Calling DataHub MCP tool "${name}" args=${JSON.stringify(args).slice(0, 300)}`);

    const res = await this.request('tools/call', { name, arguments: args });

    if (res.error) {
      throw new Error(`MCP tool "${name}" error: ${res.error.message}`);
    }

    const content = res.result?.content ?? [];
    const text = content
      .map((c) => (c.type === 'text' ? (c.text ?? '') : ''))
      .filter(Boolean)
      .join('\n');
    const isError = Boolean(res.result?.isError);

    if (isError) {
      throw new Error(`MCP tool "${name}" reported an error: ${text.slice(0, 300)}`);
    }

    log(`MCP tool "${name}" returned ${text.length} chars (isError=${isError})`);
    return { toolName: name, text, isError };
  }

  /** Shuts the transport down (kills the subprocess). */
  close(): void {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    for (const { reject } of this.pending.values()) {
      reject(new Error('MCP client closed'));
    }
    this.pending.clear();
    this.connected = false;
  }

  // ─── Transport plumbing ─────────────────────────────────────────────────────

  private async spawnChild(): Promise<void> {
    const command = this.options.command as string;
    const args = this.options.args ?? [];

    log(`Spawning MCP server: ${command} ${args.join(' ')}`);

    this.child = spawn(command, args, {
      env: { ...process.env, ...this.options.serverEnv },
      shell: false,
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');

    this.child.stdout.on('data', (chunk: string) => {
      this.stdoutBuffer += chunk;
      let nl: number;
      while ((nl = this.stdoutBuffer.indexOf('\n')) >= 0) {
        const line = this.stdoutBuffer.slice(0, nl).trim();
        this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
        if (line) this.handleMessage(line);
      }
    });

    this.child.stderr.on('data', (chunk: string) => {
      // The DataHub MCP server logs to stderr; surface as diagnostics.
      console.log(`[DataHubMcp][server] ${chunk.trimEnd()}`);
    });

    this.child.on('error', (error) => {
      warn(`MCP server process failed to spawn: ${error.message}`);
      this.connected = false;
      this.rejectAll(error);
    });

    this.child.on('close', (code) => {
      warn(`MCP server process exited (code ${code ?? 'signal'}).`);
      this.connected = false;
      this.rejectAll(new Error(`MCP server process exited (code ${code ?? 'signal'})`));
    });
  }

  private async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'eduaudio-relay', version: '1.0.5' },
    });
    this.notify('notifications/initialized', {});
    log('MCP initialize handshake complete');
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.sendRaw({ jsonrpc: '2.0', method, params });
  }

  private request(method: string, params: Record<string, unknown>): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.sendRaw({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private sendRaw(payload: Record<string, unknown>): void {
    if (this.options.url) {
      this.sendHttp(payload).catch((error) => {
        const id = payload.id as number | undefined;
        if (id !== undefined) {
          const entry = this.pending.get(id);
          if (entry) {
            clearTimeout(entry.timer);
            this.pending.delete(id);
            entry.reject(error instanceof Error ? error : new Error(String(error)));
          }
        }
      });
      return;
    }

    if (!this.child) {
      throw new Error('MCP subprocess is not running; call connect() first.');
    }
    this.child.stdin.write(JSON.stringify(payload) + '\n');
  }

  private handleMessage(line: string): void {
    let msg: JsonRpcResponse & { method?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      warn(`Ignoring non-JSON line from MCP server: ${line.slice(0, 120)}`);
      return;
    }

    if (msg.method !== undefined) {
      // Server-initiated notification; nothing to route.
      return;
    }

    const entry = this.pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(msg.id);
    entry.resolve(msg);
  }

  private rejectAll(error: Error): void {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }

  // ─── HTTP (streamable) transport, best-effort ───────────────────────────────

  private async sendHttp(payload: Record<string, unknown>): Promise<void> {
    if (!this.options.url) throw new Error('No MCP URL configured');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (this.options.token) headers.Authorization = `Bearer ${this.options.token}`;
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.options.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const incomingSession = response.headers.get('Mcp-Session-Id');
      if (incomingSession) this.sessionId = incomingSession;

      const contentType = response.headers.get('Content-Type') ?? '';
      const raw = await response.text();

      let parsed: unknown = null;
      if (contentType.includes('text/event-stream') || raw.trim().startsWith('data:')) {
        parsed = this.parseSse(raw);
      } else if (raw.trim()) {
        parsed = JSON.parse(raw);
      }

      if (parsed === null) {
        throw new Error(`MCP HTTP endpoint returned ${response.status} with no parseable body`);
      }

      const id = payload.id as number;
      const entry = this.pending.get(id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
        if (response.ok) {
          entry.resolve(parsed as JsonRpcResponse);
        } else {
          entry.reject(
            new Error(`MCP HTTP endpoint returned status ${response.status}: ${raw.slice(0, 300)}`)
          );
        }
      }
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  private parseSse(raw: string): JsonRpcResponse | null {
    let data: string | null = null;
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith('data:')) {
        data = line.slice(5).trim();
        if (data === '[DONE]') break;
        if (data) {
          try {
            return JSON.parse(data) as JsonRpcResponse;
          } catch {
            // fall through to next data line
          }
        }
      }
    }
    return data ? (JSON.parse(data) as JsonRpcResponse) : null;
  }
}
