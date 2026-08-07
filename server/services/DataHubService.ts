/**
 * server/services/DataHubService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Backend DataHub orchestration for the EduAudio relay.
 *
 * Every metadata lookup and telemetry write-back is attempted through the
 * DataHub MCP Server interface first, then the real DataHub GMS GraphQL API
 * (search / dataset), and finally degrades to a local mock catalog. The
 * mobile app therefore never sees a hard failure when external DataHub
 * credentials or the MCP server are unavailable.
 *
 * DataHub MCP Server configuration (all optional):
 *   - DATAHUB_MCP_URL        streamable HTTP endpoint of an MCP server
 *   - DATAHUB_MCP_COMMAND    stdio command (e.g. `uvx` or `python`)
 *   - DATAHUB_MCP_ARGS       space-separated args (e.g. mcp-server-datahub@latest)
 *   - DATAHUB_MCP_TOKEN      optional bearer token for the HTTP endpoint
 *   - DATAHUB_GMS_TOKEN      token forwarded to the MCP server process
 *                            (DATAHUB_PAT_TOKEN is used as a fallback)
 *   - DATAHUB_LESSON_URN     lesson Dataset URN used for `update_description`
 *                            mutation write-backs
 *
 * GraphQL fallback configuration:
 *   - DATAHUB_GMS_URL        DataHub GMS base origin
 *   - DATAHUB_PAT_TOKEN      Personal Access Token
 *
 * Resolution order per request: MCP Server -> GraphQL -> LOCAL MOCK.
 * Telemetry is also aggregated in memory and can be flushed back to DataHub
 * as an insights Document so the next agent inherits aggregated knowledge.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { DataHubMcpClient } from './datahubMcpClient';

export type DataHubMode = 'mcp' | 'datahub' | 'mock';

export interface OutlineItem {
  id: string;
  title: string;
  pageNumber: number;
  level: number;
  description?: string;
}

export interface DocumentPayload {
  id: string;
  title: string;
  outline: OutlineItem[];
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

export interface InsightsSnapshot {
  totalSessions: number;
  totalDurationMs: number;
  byIntent: Record<string, number>;
  byOutcome: Record<string, number>;
  failedCommands: number;
  windowStart: string;
  windowEnd: string;
}

export interface FlushInsightsResult {
  written: boolean;
  source: 'mcp' | 'mock';
  reason?: string;
  title?: string;
  snapshot?: InsightsSnapshot;
}

const VERSION = '1.0.5';
const INSIGHT_WINDOW_SESSIONS = 10;

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
  const lessonUrn = (process.env.DATAHUB_LESSON_URN ?? '').trim();

  return {
    isConfigured: url.length > 0 || command.length > 0,
    url: url || undefined,
    command: command || undefined,
    args: argsRaw ? argsRaw.split(/\s+/).filter(Boolean) : [],
    token: token || undefined,
    lessonUrn: lessonUrn || undefined,
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

// Real DataHub GMS GraphQL: entity search + dataset detail. Unlike the older
// custom `document(id)` schema, these queries run against any DataHub GMS.
const SEARCH_QUERY = `
  query SearchCourses($input: SearchInput!) {
    search(input: $input) {
      total
      start
      count
      searchResults {
        entity {
          ... on Dataset {
            urn
            name
            properties { name description }
            ownership { owners { owner { ... on CorpUser { urn properties { displayName } } } } }
            domains { domains { ... on Domain { urn properties { name } } } }
          }
          ... on Document {
            urn
            properties { name }
          }
        }
      }
    }
  }
`;

const DATASET_QUERY = `
  query GetDatasetDetail($urn: String!) {
    dataset(urn: $urn) {
      urn
      name
      properties { name description }
      schemaMetadata { fields { fieldPath nativeDataType description } }
      glossaryTerms { terms { term { urn } } }
      ownership { owners { owner { ... on CorpUser { urn properties { displayName } } } } }
      domains { domains { ... on Domain { urn properties { name } } } }
    }
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
 * Extract a document/entity list from an MCP tool response. Accepts:
 *   - { "results": [ { urn, name|displayName|title } ] }   (search_documents)
 *   - { "entities": [ { urn, name } ] }                    (search)
 *   - a bare JSON array
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
    for (const key of ['results', 'entities', 'documents']) {
      if (Array.isArray(obj[key])) {
        entries.push(...(obj[key] as Array<Record<string, unknown>>));
        break;
      }
    }
  }

  const docs: Array<{ id: string; title: string }> = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const props = (entry.properties ?? {}) as Record<string, unknown>;
    const title = String(
      entry.name ?? entry.displayName ?? entry.title ?? props.name ?? props.title ?? ''
    ).trim();
    const id = String(entry.urn ?? entry.id ?? entry.entityUrn ?? props.urn ?? '').trim();
    if (title || id) {
      docs.push({ id: id || title, title: title || id });
    }
  }
  return docs;
}

/**
 * Extract per-URN descriptions from a `get_entities` response shaped like
 * `{ entities: { "<urn>": { properties: { name, description } } } }`.
 */
function extractEntityDescriptions(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!text || !text.trim()) return out;
  try {
    const parsed = JSON.parse(text) as { entities?: Record<string, any> };
    const entities = parsed.entities;
    if (!entities || typeof entities !== 'object') return out;
    for (const [urn, entity] of Object.entries(entities)) {
      const description = String(
        entity?.properties?.description ?? entity?.description ?? ''
      ).trim();
      if (description) out[urn] = description;
    }
  } catch {
    // ignore unparseable enrichment
  }
  return out;
}

function docsToOutline(docs: Array<{ id: string; title: string }>, descriptions: Record<string, string> = {}): OutlineItem[] {
  return docs.map((doc, index) => ({
    id: doc.id,
    title: doc.title,
    pageNumber: index + 1,
    level: 1,
    ...(descriptions[doc.id] ? { description: descriptions[doc.id] } : {}),
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

function emptyInsights(): InsightsSnapshot {
  const now = new Date().toISOString();
  return {
    totalSessions: 0,
    totalDurationMs: 0,
    byIntent: {},
    byOutcome: {},
    failedCommands: 0,
    windowStart: now,
    windowEnd: now,
  };
}

function markdownInsights(snapshot: InsightsSnapshot): string {
  const lines = [
    `# EduAudio Voice Session Insights`,
    '',
    `- Window: ${snapshot.windowStart} -> ${snapshot.windowEnd}`,
    `- Total sessions: ${snapshot.totalSessions}`,
    `- Total engagement: ${(snapshot.totalDurationMs / 1000).toFixed(1)}s`,
    `- Failed commands: ${snapshot.failedCommands}`,
    '',
    '## Intents',
  ];
  for (const [intent, count] of Object.entries(snapshot.byIntent).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${intent}: ${count}`);
  }
  lines.push('', '## Outcomes');
  for (const [outcome, count] of Object.entries(snapshot.byOutcome).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${outcome}: ${count}`);
  }
  return lines.join('\n');
}

/**
 * Backend DataHub orchestrator: MCP Server -> GraphQL -> local mock.
 */
class DataHubService {
  private readonly mcp: DataHubMcpClient;
  private readonly lessonUrn: string | undefined;
  private insights: InsightsSnapshot = emptyInsights();

  constructor() {
    const mcpConfig = resolveMcpConfig();
    this.lessonUrn = mcpConfig.lessonUrn;
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
   * (save_document + optional update_description mutation), then the GraphQL
   * mutation, then a local acknowledgment. Never throws.
   */
  async recordTelemetry(payload: Record<string, unknown>): Promise<TelemetryResult> {
    this.aggregate(payload);

    const telemetryId = payload.telemetryId as string | undefined;

    if (this.mcp.isConfigured) {
      try {
        const result = await this.recordViaMcp(payload, telemetryId);
        if (this.insights.totalSessions >= INSIGHT_WINDOW_SESSIONS) {
          // Auto-flush aggregated insights back to DataHub so the next
          // person or agent inherits the aggregated knowledge.
          await this.flushInsights();
        }
        return result;
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

  /** Current in-memory session insights (aggregated from telemetry). */
  getInsights(): InsightsSnapshot {
    return { ...this.insights };
  }

  /**
   * Write the aggregated session insights back to DataHub as a knowledge
   * Document via the MCP `save_document` tool. Resets the window on success.
   */
  async flushInsights(): Promise<FlushInsightsResult> {
    const snapshot = this.getInsights();

    if (snapshot.totalSessions === 0) {
      return { written: false, source: 'mock', reason: 'no sessions recorded in the current window' };
    }

    if (!this.mcp.isConfigured) {
      return {
        written: false,
        source: 'mock',
        reason: 'MCP Server not configured; set DATAHUB_MCP_URL or DATAHUB_MCP_COMMAND',
      };
    }

    try {
      await this.mcp.connect();
      const title = `EduAudio Voice Session Insights ${new Date().toISOString().slice(0, 10)}`;
      const content = `${markdownInsights(snapshot)}\n\n\`\`\`json\n${JSON.stringify(
        snapshot,
        null,
        2
      )}\n\`\`\``;

      log(`Writing aggregated insights document via save_document (${title})`);
      await this.mcp.callTool('save_document', { title, content });

      this.insights = emptyInsights();
      return { written: true, source: 'mcp', title, snapshot };
    } catch (error) {
      warn('Insights write-back to MCP failed.', error);
      return {
        written: false,
        source: 'mock',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ─── MCP Server path ─────────────────────────────────────────────────────────

  private async fetchViaMcp(documentId: string): Promise<QueryEnvelope> {
    await this.mcp.connect();
    try {
      await this.mcp.listTools();
    } catch {
      // tool listing is diagnostic-only; continue with the call.
    }

    let docs: Array<{ id: string; title: string }> = [];
    let toolUsed = 'search_documents';

    log(`MCP context read for "${documentId}" via search_documents`);
    const searchDocs = await this.mcp.callTool('search_documents', { query: documentId });
    docs = extractDocuments(searchDocs.text);

    if (docs.length === 0) {
      // Document knowledge-base may be empty; fall back to dataset search.
      toolUsed = 'search';
      log(`search_documents empty; trying dataset "search" tool for "${documentId}"`);
      const search = await this.mcp.callTool('search', { query: documentId });
      docs = extractDocuments(search.text);
    }

    if (docs.length === 0) {
      throw new Error(`MCP returned no usable results for "${documentId}" (${toolUsed}).`);
    }

    // Best-effort enrichment with schema/property metadata.
    const descriptions: Record<string, string> = {};
    try {
      const entities = await this.mcp.callTool('get_entities', {
        urns: docs.slice(0, 5).map((doc) => doc.id),
      });
      Object.assign(descriptions, extractEntityDescriptions(entities.text));
    } catch {
      log('get_entities enrichment skipped (tool unavailable or error).');
    }

    const outline = docsToOutline(docs, descriptions);
    const headings = docsToHeadings(docs);

    log(`MCP returned ${docs.length} result(s) for "${documentId}" via ${toolUsed}; serving as outline.`);
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
        mcp: { transport: this.mcp.transportLabel, tool: toolUsed },
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

    // Governance contribution: append the session to the lesson Dataset's
    // description via the MCP mutation tool (TOOLS_IS_MUTATION_ENABLED=true).
    if (this.lessonUrn) {
      try {
        const append = `\n\nLatest engagement (${new Date().toISOString()}): ${buildTelemetrySummary(
          payload
        )}`;
        log(`MCP mutation: update_description on ${this.lessonUrn}`);
        await this.mcp.callTool('update_description', {
          urn: this.lessonUrn,
          description: append,
        });
      } catch (error) {
        warn('MCP update_description mutation skipped (may be disabled).', error);
      }
    }

    return {
      accepted: true,
      telemetryId: id,
      source: 'mcp',
      datahubWriteBack: true,
      mcp: { transport: this.mcp.transportLabel, tool: 'save_document' },
    };
  }

  // ─── GraphQL relay path (real DataHub GMS API) ───────────────────────────────

  private async fetchViaGraphQl(
    gmsUrl: string,
    patToken: string,
    documentId: string
  ): Promise<QueryEnvelope> {
    const endpoint = buildGraphQlEndpoint(gmsUrl);
    log(`GraphQL context read for "${documentId}" via ${endpoint}`);

    const searchResponse = await fetch(endpoint, {
      method: 'POST',
      headers: this.graphQlHeaders(patToken),
      body: JSON.stringify({
        query: SEARCH_QUERY,
        variables: {
          input: { type: 'DATASET', query: documentId, start: 0, count: 20 },
        },
      }),
    });

    const searchResult = (await searchResponse.json()) as {
      errors?: unknown;
      data?: {
        search?: {
          searchResults?: Array<{ entity?: Record<string, any> }>;
        };
      };
    };

    if (!searchResponse.ok || searchResult.errors) {
      throw new Error(
        `GraphQL search degraded (${searchResponse.status}): ${JSON.stringify(
          searchResult.errors ?? 'no data'
        )}`
      );
    }

    const results = searchResult.data?.search?.searchResults ?? [];
    const docs = results
      .map(({ entity }) => entity)
      .filter((entity): entity is Record<string, any> => Boolean(entity))
      .map((entity) => ({
        id: String(entity.urn ?? ''),
        title: String(
          entity.name ?? entity.properties?.name ?? entity.properties?.title ?? entity.urn ?? ''
        ),
      }))
      .filter((doc) => doc.id);

    if (docs.length === 0) {
      throw new Error(`GraphQL search returned no dataset results for "${documentId}".`);
    }

    // Enrichment: dataset detail (schema, ownership, domains).
    const descriptions: Record<string, string> = {};
    try {
      const detailResponse = await fetch(endpoint, {
        method: 'POST',
        headers: this.graphQlHeaders(patToken),
        body: JSON.stringify({
          query: DATASET_QUERY,
          variables: { urn: docs[0].id },
        }),
      });
      const detail = (await detailResponse.json()) as { data?: { dataset?: any } };
      const dataset = detail.data?.dataset;
      if (dataset?.properties?.description) {
        descriptions[dataset.urn] = String(dataset.properties.description);
      }
    } catch (error) {
      warn('GraphQL dataset detail enrichment skipped.', error);
    }

    const outline = docsToOutline(docs, descriptions);
    const headings = docsToHeadings(docs);

    log(`GraphQL returned ${docs.length} dataset result(s); serving as outline.`);
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

    // Real DataHub write-back: attach an ownership/structure-free aspect via
    // the REST ingest endpoint is out of scope here; report the attempt so
    // telemetry routing still resolves. Prefer MCP mutation tools instead.
    log('GraphQL telemetry mutation not supported by real DataHub GMS; marking as unacknowledged.');
    void endpoint;
    void payload;
    void patToken;
    return false;
  }

  private graphQlHeaders(patToken: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${patToken}`,
    };
  }

  // ─── Insight aggregation ─────────────────────────────────────────────────────

  private aggregate(payload: Record<string, unknown>): void {
    const intent = String(payload.intent ?? payload.command ?? 'voice_session');
    const outcome = String(payload.outcome ?? 'success');
    const duration = typeof payload.durationMs === 'number' ? payload.durationMs : 0;

    this.insights.totalSessions += 1;
    this.insights.totalDurationMs += duration;
    this.insights.byIntent[intent] = (this.insights.byIntent[intent] ?? 0) + 1;
    this.insights.byOutcome[outcome] = (this.insights.byOutcome[outcome] ?? 0) + 1;
    if (outcome !== 'success') this.insights.failedCommands += 1;
    this.insights.windowEnd = new Date().toISOString();
  }
}

// Export singleton
export const dataHubService = new DataHubService();
