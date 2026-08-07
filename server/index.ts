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
 * Environment:
 *   DATAHUB_GMS_URL      DataHub GMS base origin (default http://localhost:8080)
 *   DATAHUB_PAT_TOKEN    Personal Access Token for authenticated GraphQL calls
 *   PORT                 HTTP port for the relay (default 3001)
 *
 * When DATAHUB_GMS_URL or DATAHUB_PAT_TOKEN are missing the server still runs
 * in MOCK MODE: /api/datahub/query returns offline catalog data and telemetry
 * is acknowledged locally, so the mobile app never sees a hard failure.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';

const app = express();

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const DATAHUB_GMS_URL = (process.env.DATAHUB_GMS_URL ?? '').trim();
const DATAHUB_PAT_TOKEN = (process.env.DATAHUB_PAT_TOKEN ?? '').trim();
const DATAHUB_ENABLED = DATAHUB_GMS_URL.length > 0 && DATAHUB_PAT_TOKEN.length > 0;

const graphQlEndpoint = `${DATAHUB_GMS_URL.replace(/\/+$/, '')}/api/graphql`;

// Open CORS so the mobile app (and web preview) can reach the relay from any origin.
app.use(cors());
app.use(express.json({ limit: '1mb' }));

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
 * Build a mock educational document payload used when DataHub is not
 * configured or unreachable. Mirrors the client-side fallback catalog.
 */
function buildMockDocument(documentId: string): Record<string, unknown> {
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

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'eduaudio-relay',
    datahubMode: DATAHUB_ENABLED ? 'datahub' : 'mock',
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
    if (!DATAHUB_ENABLED) {
      console.warn('[relay] DataHub not configured, serving mock context.');
      res.json({
        data: { document: buildMockDocument(documentId) },
        metadata: {
          source: 'mock',
          version: '1.0.4',
          generatedAt: new Date().toISOString(),
          cacheStatus: 'MISS',
        },
      });
      return;
    }

    const upstream = await fetch(graphQlEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${DATAHUB_PAT_TOKEN}`,
      },
      body: JSON.stringify({
        query: DOCUMENT_QUERY,
        variables: { id: documentId },
      }),
    });

    const result = await upstream.json();

    if (!upstream.ok || result.errors || !result.data?.document) {
      console.warn('[relay] DataHub upstream degraded, serving mock context.', result.errors ?? upstream.status);
      res.json({
        data: { document: buildMockDocument(documentId) },
        metadata: {
          source: 'mock',
          version: '1.0.4',
          generatedAt: new Date().toISOString(),
          cacheStatus: 'MISS',
          upstreamError: String(result.errors ?? upstream.status),
        },
      });
      return;
    }

    res.json({
      ...result,
      metadata: {
        source: 'datahub',
        version: '1.0.4',
        generatedAt: new Date().toISOString(),
        cacheStatus: 'HIT',
      },
    });
  } catch (error) {
    console.error('[relay] Query handler error:', error);
    res.json({
      data: { document: buildMockDocument(documentId) },
      metadata: {
        source: 'mock',
        version: '1.0.4',
        generatedAt: new Date().toISOString(),
        cacheStatus: 'MISS',
        upstreamError: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

// ─── Telemetry write-back ─────────────────────────────────────────────────────

app.post('/api/datahub/telemetry', async (req, res) => {
  const payload = req.body ?? {};

  try {
    const telemetryId = randomUUID();
    console.log(`[relay] Telemetry received (${telemetryId}):`, JSON.stringify(payload).slice(0, 500));

    if (!DATAHUB_ENABLED) {
      res.status(202).json({ accepted: true, telemetryId, source: 'mock' });
      return;
    }

    let upstreamAccepted = false;
    try {
      const upstream = await fetch(graphQlEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${DATAHUB_PAT_TOKEN}`,
        },
        body: JSON.stringify({
          query: TELEMETRY_MUTATION,
          variables: { payload: JSON.stringify(payload) },
        }),
      });

      const result = await upstream.json();
      upstreamAccepted = upstream.ok && !result.errors;
      console.log(`[relay] DataHub telemetry write-back ${upstreamAccepted ? 'accepted' : 'rejected'}.`);
    } catch (error) {
      console.warn('[relay] DataHub telemetry write-back failed, acknowledged locally:', error);
    }

    res.status(202).json({
      accepted: true,
      telemetryId,
      source: upstreamAccepted ? 'datahub' : 'mock',
      datahubWriteBack: upstreamAccepted,
    });
  } catch (error) {
    console.error('[relay] Telemetry handler error:', error);
    res.status(500).json({ accepted: false, errors: [error instanceof Error ? error.message : String(error)] });
  }
});

// ─── Listen ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[relay] EduAudio relay listening on port ${PORT}`);
  console.log(`[relay] DataHub mode: ${DATAHUB_ENABLED ? `connected (${DATAHUB_GMS_URL})` : 'mock (no GMS URL / PAT token configured)'}`);
});
