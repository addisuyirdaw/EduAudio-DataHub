/**
 * server/services/DataHubService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Backend DataHub orchestration for the EduAudio relay.
 *
 * Every metadata lookup and telemetry write-back is attempted through the
 * DataHub MCP Server interface first, then the raw DataHub GraphQL relay,
 * and finally degrades to a local mock catalog. The mobile app therefore
 * never sees a hard failure when external DataHub credentials or the MCP
 * server are unavailable.
 *
 * DataHub MCP Server configuration (all optional):
 *   - DATAHUB_MCP_URL        streamable HTTP endpoint of an MCP server
 *   - DATAHUB_MCP_COMMAND    stdio command (e.g. `uvx` or `python`)
 *   - DATAHUB_MCP_ARGS       space-separated args (e.g. mcp-server-datahub@latest)
 *   - DATAHUB_MCP_TOKEN      optional bearer token for the HTTP endpoint
 *   - DATAHUB_GMS_TOKEN      token forwarded to the MCP server process
 *                            (DATAHUB_PAT_TOKEN is used as a fallback)
 *
 * GraphQL fallback configuration:
 *   - DATAHUB_GMS_URL        DataHub GMS base origin
 *   - DATAHUB_PAT_TOKEN      Personal Access Token
 *
 * Resolution order per request: MCP Server -> GraphQL -> LOCAL MOCK.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { DataHubMcpClient } from './datahubMcpClient';

export type DataHubMode = 'mcp' | 'datahub' | 'mock';

export interface DocumentPayload {
  id: string;
  title: string;
  outline: Array<{ id: string; title: string; pageNumber: number; level: number }>;
  headings: Array<{ level: number; text: string; position: number }>;
  accessibility: {
    hasTranscript: boolean;
    hasAltText: boolean;
    isScreenReaderOptimized: boolean;
    isTalkBackOptimized: boolean;
    isVoiceOverOptimized: boolean;
  };
}

export interface QueryEnvelope {
  data: { document: DocumentPayload };
  metadata: {
    source: string;
    version: string;
    generatedAt: string;
    cacheStatus: 'HIT' | 'MISS';
    upstreamError?: string;
    mcp?: { transport: string; tool: string };
  };
}

export interface TelemetryResult {
  accepted: boolean;
  telemetryId: string;
  source: 'mcp' | 'datahub' | 'mock';
  datahubWriteBack: boolean;
  mcp?: { transport: string; tool: string };
}

const VERSION = '1.0.5';

function log(message: string): void {
  console.log(`[DataHubService] ${message}`);
}

function warn(message: string, error?: unknown): void {
  console.warn(`[DataHubService] ${message}`, error ?? '');
}

/**
 * Resolve the DataHub MCP Server configuration from the environment.
 */
function resolveMcpConfig() {
  const url = (process.env.DATAHUB_MCP_URL ?? '').trim();
  const command = (process.env.DATAHUB_MCP_COMMAND ?? '').trim();
  const argsRaw = (process.env.DATAHUB_MCP_ARGS ?? '').trim();
  const token = (process.env.DATAHUB_MCP_TOKEN ?? '').trim();

  const isConfigured = url.length > 0 || command.length > 0;

  return {
    isConfigured,
    url: url || undefined,
    command: command || undefined,
    args: argsRaw ? argsRaw.split(/\s+/).filter(Boolean) : [],
    token: token || undefined,
    serverEnv: {
      // The DataHub MCP server reads its connection settings from these env
      // vars; forward the relay's DataHub settings to the spawned process.
      DATAHUB_GMS_URL: process.env.DATAHUB_GMS_URL ?? '',
      DATAHUB_GMS_TOKEN:
        process.env.DATAHUB_GMS_TOKEN ?? process.env.DATAHUB_PAT_TOKEN ?? '',
    },
  };
}

/**
 * Resolve the raw GraphQL fallback configuration.
 */
function resolveGraphQlConfig() {
  const gmsUrl = (process.env.DATAHUB_GMS_URL ?? '').trim();
  const patToken = (process.env.DATAHUB_PAT_TOKEN ?? '').trim();
  return {
    isConfigured: gmsUrl.length > 0 && patToken.length > 0,
    gmsUrl,
    patToken,
  };
}

function buildGraphQlEndpoint(gmsUrl: string): string {
  return `${gmsUrl.replace(/\/+$/, '')}/api/graphql`;
}

const DOCUMENT_QUERY = `
  query GetEducationalMetadata($id: String!) {
    document(id: $id) {
      id
      outline {
        id
        title
        pageNumber
        level
      }
      headings {
        level
        text
        position
      }
      accessibility {
        hasTranscript
        hasAltText
        isScreenReaderOptimized
      }
    }
  }
`;

const TELEMETRY_MUTATION = `
  mutation RecordTelemetry($payload: String!) {
    recordTelemetry(input: $payload)
  }
`;

/**
 * Build the offline mock document used whenever DataHub (MCP or GraphQL)
 * is not configured or unreachable.
 */
function buildMockDocument(documentId: string): DocumentPayload {
  return {
    id: documentId,
    title: 'Offline Educational Catalog',
    outline: [
      { id: 'toc-1', title: 'Preface', pageNumber: 1, level: 1 },
      { id: 'toc-2', title: 'Chapter 1: Educational Foundations', pageNumber: 5, level: 1 },
      { id: 'toc-3', title: '1.1 Accessibility Standards', pageNumber: 12, level: 2 },
      { id: 'toc-4', title: 'Conclusion', pageNumber: 45, level: 1 },
    ],
    headings: [
      { level: 1, text: 'Preface', position: 0 },
      { level: 1, text: 'Educational Foundations', position: 1000 },
      { level: 2, text: 'Accessibility Standards', position: 2500 },
    ],
    accessibility: {
      hasTranscript: true,
      hasAltText: false,
      isScreenReaderOptimized: true,
      isTalkBackOptimized: true,
      isVoiceOverOptimized: true,
    },
  };
}

/**
 * Extract a document list from an MCP tool response. The DataHub MCP
 * `search_documents` tool returns a JSON text payload with a `results`
 * array; `get_entities` returns entities keyed by URN. We accept any of
 * those shapes and normalize to `{ id, title }`.
 */
function extractDocuments(text: string): Array<{ id: string; title: string }> {
  if (!text || !text.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  const entries: Array<Record<string, unknown>> = [];

  if (Array.isArray(parsed)) {
    entries.push(...(parsed as Array<Record<string, unknown>>));
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.results)) {
      entries.push(...(obj.results as Array<Record<string, unknown>>));
    } else if (Array.isArray(obj.entities)) {
      entries.push(...(obj.entities as Array<Record<string, unknown>>));
    } else if (Array.isArray(obj.documents)) {
      entries.push(...(obj.documents as Array<Record<string, unknown>>));
    }
  }

  const docs: Array<{ id: string; title: string }> = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const title =
      String(entry.name ?? entry.displayName ?? entry.title ?? entry.qualifiedName ?? '').trim();
    const id = String(entry.urn ?? entry.id ?? entry.entityUrn ?? '').trim();
    if (title || id) {
      docs.push({ id: id || title, title: title || id });
    }
  }
  return docs;
}

/**
 * Convert a DataHub MCP document list into EduAudio's outline shape.
 */
function docsToOutline(
  docs: Array<{ id: string; title: string }>
): DocumentPayload['outline'] {
  return docs.map((doc, index) => ({
    id: doc.id,
    title: doc.title,
    pageNumber: index + 1,
    level: 1,
  }));
}

function docsToHeadings(docs: Array<{ id: string; title: string }>): DocumentPayload['headings'] {
  return docs.map((doc, index) => ({
    level: 1,
    text: doc.title,
    position: index * 1000,
  }));
}

/**
 * Build a human-readable one-line summary from a telemetry payload so the
 * DataHub document saved by the MCP `save_document` tool is actually useful
 * to the next person or agent that reads the catalog.
 */
function buildTelemetrySummary(payload: Record<string, unknown>): string {
  const intent = payload.intent ?? payload.command ?? 'voice session';
  const sessionId = payload.sessionId ?? 'unknown session';
  const duration =
    typeof payload.durationMs === 'number' ? `${(payload.durationMs / 1000).toFixed(1)}s` : 'n/a';
  const documentId = payload.documentId ?? 'n/a';
  return [
    `EduAudio voice session ${sessionId}.`,
    `Intent: ${String(intent)}.`,
    `Duration: ${duration}.`,
    `Document: ${String(documentId)}.`,
  ].join(' ');
}

/**
 * Backend DataHub orchestrator: MCP Server -> GraphQL -> local mock.
 */
class DataHubService {
  private readonly mcp: DataHubMcpClient;

  constructor() {
    const mcpConfig = resolveMcpConfig();
    this.mcp = new DataHubMcpClient({
      url: mcpConfig.url,
      command: mcpConfig.command,
      args: mcpConfig.args,
      token: mcpConfig.token,
      serverEnv: mcpConfig.serverEnv,
    });
  }

  /** The effective backend mode based on configuration, not liveness. */
  getMode(): DataHubMode {
    if (resolveMcpConfig().isConfigured) return 'mcp';
    if (resolveGraphQlConfig().isConfigured) return 'datahub';
    return 'mock';
  }

  /** Diagnostics for the health endpoint. */
  getMcpDiagnostics(): { configured: boolean; transport: string | null } {
    if (!this.mcp.isConfigured) return { configured: false, transport: null };
    return { configured: true, transport: this.mcp.transportLabel };
  }

  /**
   * Fetch educational document context (outline, headings, accessibility).
   * Attempts the DataHub MCP Server path, then the GraphQL relay, then mock.
   * Never throws.
   */
  async fetchDocumentContext(documentId: string): Promise<QueryEnvelope> {
    if (this.mcp.isConfigured) {
      try {
        return await this.fetchViaMcp(documentId);
      } catch (error) {
        warn('MCP Server path failed; falling back to GraphQL/mock.', error);
      }
    }

    const graphQl = resolveGraphQlConfig();
    if (graphQl.isConfigured) {
      try {
        return await this.fetchViaGraphQl(graphQl.gmsUrl, graphQl.patToken, documentId);
      } catch (error) {
        warn('GraphQL relay path failed; serving mock context.', error);
      }
    }

    warn(
      `No MCP or DataHub config available (or upstreams degraded). Serving LOCAL MOCK for "${documentId}".`
    );
    return {
      data: { document: buildMockDocument(documentId) },
      metadata: {
        source: 'mock',
        version: VERSION,
        generatedAt: new Date().toISOString(),
        cacheStatus: 'MISS',
      },
    };
  }

  /**
   * Record a voice-session telemetry write-back. Attempts the MCP Server path
   * (save_document / update_description), then the GraphQL mutation, then a
   * local acknowledgment. Never throws.
   */
  async recordTelemetry(payload: Record<string, unknown>): Promise<TelemetryResult> {
    const telemetryId = payload.telemetryId as string | undefined;

    if (this.mcp.isConfigured) {
      try {
        return await this.recordViaMcp(payload, telemetryId);
      } catch (error) {
        warn('MCP telemetry write-back failed; falling back.', error);
      }
    }

    const graphQl = resolveGraphQlConfig();
    if (graphQl.isConfigured) {
      try {
        const accepted = await this.writeTelemetryViaGraphQl(
          graphQl.gmsUrl,
          graphQl.patToken,
          payload
        );
        return {
          accepted: true,
          telemetryId: telemetryId ?? crypto.randomUUID(),
          source: accepted ? 'datahub' : 'mock',
          datahubWriteBack: accepted,
        };
      } catch (error) {
        warn('GraphQL telemetry write-back failed; acknowledged locally.', error);
      }
    }

    return {
      accepted: true,
      telemetryId: telemetryId ?? crypto.randomUUID(),
      source: 'mock',
      datahubWriteBack: false,
    };
  }

  // ─── MCP Server path ─────────────────────────────────────────────────────────

  private async fetchViaMcp(documentId: string): Promise<QueryEnvelope> {
    await this.mcp.connect();
    try {
      await this.mcp.listTools();
    } catch {
      // tool listing is diagnostic-only; continue with the call.
    }

    log(`MCP context read for "${documentId}" via search_documents`);
    const search = await this.mcp.callTool('search_documents', { query: documentId });

    const docs = extractDocuments(search.text);
    if (docs.length === 0) {
      throw new Error('MCP search_documents returned no usable document results.');
    }

    const outline = docsToOutline(docs);
    const headings = docsToHeadings(docs);

    log(`MCP returned ${docs.length} document(s) for "${documentId}"; serving as outline.`);
    return {
      data: {
        document: {
          id: docs[0].id,
          title: docs[0].title,
          outline,
          headings,
          accessibility: {
            hasTranscript: true,
            hasAltText: false,
            isScreenReaderOptimized: true,
            isTalkBackOptimized: true,
            isVoiceOverOptimized: true,
          },
        },
      },
      metadata: {
        source: 'mcp',
        version: VERSION,
        generatedAt: new Date().toISOString(),
        cacheStatus: 'HIT',
        mcp: { transport: this.mcp.transportLabel, tool: 'search_documents' },
      },
    };
  }

  private async recordViaMcp(
    payload: Record<string, unknown>,
    telemetryId?: string
  ): Promise<TelemetryResult> {
    await this.mcp.connect();

    const id = telemetryId ?? crypto.randomUUID();
    const title = `EduAudio Voice Session ${id}`;
    const body =
      `${buildTelemetrySummary(payload)}\n\n` +
      '```json\n' +
      JSON.stringify(payload, null, 2) +
      '\n```';

    log(`MCP telemetry write-back via save_document (${title})`);
    await this.mcp.callTool('save_document', { title, content: body });

    return {
      accepted: true,
      telemetryId: id,
      source: 'mcp',
      datahubWriteBack: true,
      mcp: { transport: this.mcp.transportLabel, tool: 'save_document' },
    };
  }

  // ─── GraphQL relay path ──────────────────────────────────────────────────────

  private async fetchViaGraphQl(
    gmsUrl: string,
    patToken: string,
    documentId: string
  ): Promise<QueryEnvelope> {
    const endpoint = buildGraphQlEndpoint(gmsUrl);
    log(`GraphQL context read for "${documentId}" via ${endpoint}`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${patToken}`,
      },
      body: JSON.stringify({
        query: DOCUMENT_QUERY,
        variables: { id: documentId },
      }),
    });

    const result = (await response.json()) as {
      errors?: unknown;
      data?: { document?: DocumentPayload };
    };

    if (!response.ok || result.errors || !result.data?.document) {
      throw new Error(
        `GraphQL degraded (${response.status}): ${JSON.stringify(result.errors ?? 'no document')}`
      );
    }

    log(`GraphQL returned document "${result.data.document.id}"`);
    return {
      data: { document: result.data.document },
      metadata: {
        source: 'datahub',
        version: VERSION,
        generatedAt: new Date().toISOString(),
        cacheStatus: 'HIT',
      },
    };
  }

  private async writeTelemetryViaGraphQl(
    gmsUrl: string,
    patToken: string,
    payload: Record<string, unknown>
  ): Promise<boolean> {
    const endpoint = buildGraphQlEndpoint(gmsUrl);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${patToken}`,
      },
      body: JSON.stringify({
        query: TELEMETRY_MUTATION,
        variables: { payload: JSON.stringify(payload) },
      }),
    });

    const result = (await response.json()) as { errors?: unknown };
    const accepted = response.ok && !result.errors;
    log(`GraphQL telemetry write-back ${accepted ? 'accepted' : 'rejected'}.`);
    return accepted;
  }
}

// Export singleton
export const dataHubService = new DataHubService();
