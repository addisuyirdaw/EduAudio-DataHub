/**
 * server/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * EduAudio Backend Relay Server
 *
 * Lightweight Express API that lets the mobile app read DataHub context and
 * write back voice-session telemetry without shipping DataHub credentials in
 * the client bundle.
 *
 * Endpoints:
 *   GET  /api/health                 -> liveness + datahub mode probe
 *   POST /api/datahub/query          -> dataset/course context read (or mock)
 *   POST /api/datahub/telemetry      -> voice session telemetry write-back
 *
 * Data routing (see server/services/DataHubService.ts):
 *   1. DataHub MCP Server interface  (Model Context Protocol tool calls)
 *   2. DataHub GMS GraphQL relay
 *   3. LOCAL MOCK data when no MCP/DataHub config is available
 *
 * Environment:
 *   DATAHUB_MCP_URL       streamable HTTP endpoint of a DataHub MCP server
 *   DATAHUB_MCP_COMMAND   stdio command that launches the MCP server (uvx...)
 *   DATAHUB_MCP_ARGS      space-separated args for the MCP command
 *   DATAHUB_GMS_URL       DataHub GMS base origin (default http://localhost:8080)
 *   DATAHUB_PAT_TOKEN     Personal Access Token for authenticated GraphQL calls
 *   PORT                  HTTP port for the relay (default 3001)
 *
 * When nothing is configured the server still runs in MOCK MODE: query
 * returns offline catalog data and telemetry is acknowledged locally, so the
 * mobile app never sees a hard failure.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import express from 'express';
import cors from 'cors';
import { dataHubService } from './services/DataHubService';

const app = express();

const PORT = parseInt(process.env.PORT ?? '3001', 10);

// Open CORS so the mobile app (and web preview) can reach the relay from any origin.
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  const mode = dataHubService.getMode();
  const mcp = dataHubService.getMcpDiagnostics();

  res.json({
    status: 'ok',
    service: 'eduaudio-relay',
    datahubMode: mode,
    datahubPath: mode === 'mcp' ? 'mcp-server' : mode === 'datahub' ? 'graphql' : 'mock',
    mcp: mcp.configured
      ? { enabled: true, transport: mcp.transport }
      : { enabled: false },
    timestamp: new Date().toISOString(),
  });
});

// ─── Context read ─────────────────────────────────────────────────────────────

app.post('/api/datahub/query', async (req, res) => {
  const { documentId } = (req.body ?? {}) as { documentId?: unknown };

  if (typeof documentId !== 'string' || documentId.trim().length === 0) {
    res.status(400).json({ errors: ['Missing required field: documentId'] });
    return;
  }

  try {
    const envelope = await dataHubService.fetchDocumentContext(documentId.trim());
    console.log(`[relay] query served (source=${envelope.metadata.source}) for "${documentId}"`);
    res.json(envelope);
  } catch (error) {
    console.error('[relay] Query handler error:', error);
    res.status(500).json({ errors: [error instanceof Error ? error.message : String(error)] });
  }
});

// ─── Telemetry write-back ─────────────────────────────────────────────────────

app.post('/api/datahub/telemetry', async (req, res) => {
  const payload = req.body ?? {};

  try {
    const result = await dataHubService.recordTelemetry(payload);
    console.log(
      `[relay] Telemetry ${result.accepted ? 'accepted' : 'rejected'} (${result.telemetryId}) ` +
        `source=${result.source}`
    );

    if (!result.accepted) {
      res.status(500).json({ accepted: false, errors: ['Telemetry write-back failed'] });
      return;
    }

    res.status(202).json(result);
  } catch (error) {
    console.error('[relay] Telemetry handler error:', error);
    res.status(500).json({ accepted: false, errors: [error instanceof Error ? error.message : String(error)] });
  }
});

// ─── Listen ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  const mode = dataHubService.getMode();
  const mcp = dataHubService.getMcpDiagnostics();
  console.log(`[relay] EduAudio relay listening on port ${PORT}`);
  console.log(`[relay] DataHub mode: ${mode}`);
  if (mcp.configured) {
    console.log(`[relay] MCP Server path enabled (${mcp.transport}). Falling back to GraphQL/mock on failure.`);
  } else {
    console.log(
      '[relay] MCP Server not configured (set DATAHUB_MCP_URL or DATAHUB_MCP_COMMAND). ' +
        'Using GraphQL/mock path.'
    );
  }
});
