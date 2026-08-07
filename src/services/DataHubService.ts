/**
 * DataHubService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Metadata Catalog Engine for EduAudio.
 *
 * Interface with local DataHub instance to fetch educational structural data,
 * document outlines, and accessibility metadata via GraphQL/REST.
 *
 * Environment Configuration (optional):
 *   - EXPO_PUBLIC_API_URL: base origin of the EduAudio relay backend (Render/
 *     Vercel/ngrok), e.g. https://eduaudio-relay.onrender.com. When set, all
 *     metadata reads and telemetry write-backs are proxied through the relay's
 *     /api/datahub/query and /api/datahub/telemetry endpoints.
 *   - EXPO_PUBLIC_DATAHUB_GMS_URL (or DATAHUB_GMS_URL): base origin of the
 *     DataHub GMS instance, e.g. http://localhost:8080
 *   - EXPO_PUBLIC_DATAHUB_PAT_TOKEN (or DATAHUB_PAT_TOKEN): Personal Access
 *     Token used for authenticated reads and telemetry write-backs.
 *
 * Resolution order:
 *   1. Relay backend (EXPO_PUBLIC_API_URL) -> proxies via server/index.ts.
 *   2. Direct DataHub GMS + PAT token.
 *   3. LOCAL MOCK MODE: offline catalog data, no network request.
 *
 * When nothing is configured the service degrades to LOCAL MOCK MODE: it
 * returns offline catalog data and never issues a network request, so the
 * app cannot crash from a misconfigured backend.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Heading } from '../types/teacher.types';

/**
 * Educational metadata structure for a document
 */
export interface EducationalMetadata {
  documentId: string;
  outline: OutlineItem[];
  headings: Heading[];
  accessibility: {
    hasTranscript: boolean;
    hasAltText: boolean;
    isScreenReaderOptimized: boolean;
    isTalkBackOptimized: boolean;
    isVoiceOverOptimized: boolean;
  };
}

/**
 * Item in a document's table of contents or outline
 */
export interface OutlineItem {
  id: string;
  title: string;
  pageNumber: number;
  level: number;
  description?: string;
}

/**
 * Resolved DataHub configuration
 */
export interface DataHubConfig {
  gmsUrl: string;
  patToken: string;
  isConfigured: boolean;
}

/**
 * Resolved relay backend configuration
 */
export interface RelayConfig {
  apiUrl: string;
  isConfigured: boolean;
}

/**
 * Resolve the EduAudio relay backend origin from the environment.
 * Expo inlines EXPO_PUBLIC_* variables at build time.
 */
function resolveRelayConfig(): RelayConfig {
  const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? '').trim();
  return {
    apiUrl,
    isConfigured: apiUrl.length > 0,
  };
}

/**
 * Resolve DataHub connection settings from the environment.
 * Expo inlines EXPO_PUBLIC_* variables at build time; the unprefixed
 * forms are honored for Node-based tooling and CI as a fallback.
 */
function resolveDataHubConfig(): DataHubConfig {
  const gmsUrl = (
    process.env.EXPO_PUBLIC_DATAHUB_GMS_URL ??
    process.env.DATAHUB_GMS_URL ??
    ''
  ).trim();
  const patToken = (
    process.env.EXPO_PUBLIC_DATAHUB_PAT_TOKEN ??
    process.env.DATAHUB_PAT_TOKEN ??
    ''
  ).trim();

  return {
    gmsUrl,
    patToken,
    isConfigured: gmsUrl.length > 0 && patToken.length > 0,
  };
}

/**
 * Build the GraphQL endpoint from the GMS base origin.
 */
function buildGraphQLEndpoint(gmsUrl: string): string {
  return `${gmsUrl.replace(/\/+$/, '')}/api/graphql`;
}

// Real DataHub GMS GraphQL: entity search + dataset detail. These queries run
// against any DataHub GMS (the relay server/index.ts uses the same shape).
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
    }
  }
`;

/**
 * DataHubService manages document metadata and structural verification
 */
class DataHubService {
  private static instance: DataHubService;

  private constructor() {}

  /**
   * Singleton instance accessor
   */
  public static getInstance(): DataHubService {
    if (!DataHubService.instance) {
      DataHubService.instance = new DataHubService();
    }
    return DataHubService.instance;
  }

  /**
   * Returns the effective direct DataHub configuration.
   */
  public getConfig(): DataHubConfig {
    return resolveDataHubConfig();
  }

  /**
   * Returns the effective relay backend configuration.
   */
  public getRelayConfig(): RelayConfig {
    return resolveRelayConfig();
  }

  /**
   * Identifies which backend mode the service will use:
   *   - 'relay'  -> EXPO_PUBLIC_API_URL backend proxy
   *   - 'datahub'-> direct DataHub GMS + PAT token
   *   - 'mock'   -> local offline catalog (no network)
   */
  public getMode(): 'relay' | 'datahub' | 'mock' {
    if (resolveRelayConfig().isConfigured) return 'relay';
    if (resolveDataHubConfig().isConfigured) return 'datahub';
    return 'mock';
  }

  /**
   * True when a live backend (relay or direct DataHub) is configured.
   * When false, all service calls operate in local mock mode.
   */
  public isConfigured(): boolean {
    return this.getMode() !== 'mock';
  }

  /**
   * Fetches structured educational metadata via the relay, direct GraphQL,
   * or local mock catalog.
   * - Relay configured (EXPO_PUBLIC_API_URL): proxied by server/index.ts.
   * - Direct DataHub configured: GraphQL read against the GMS endpoint.
   * - Nothing configured or backend unreachable: local mock catalog.
   * Never throws; the app always receives verifiable metadata.
   *
   * @param documentId Unique identifier for the document
   * @returns Promise resolving to EducationalMetadata
   */
  public async fetchMetadata(documentId: string): Promise<EducationalMetadata> {
    const relay = resolveRelayConfig();

    if (relay.isConfigured) {
      console.log(`[DataHubService] Fetching metadata via relay: ${relay.apiUrl}`);
      try {
        return await this.fetchViaRelay(relay.apiUrl, documentId);
      } catch (error) {
        console.warn('[DataHubService] Relay fetch failed. Falling back to local catalog.', error);
        return this.getFallbackMetadata(documentId);
      }
    }

    const config = resolveDataHubConfig();

    if (!config.isConfigured) {
      console.warn(
        `[DataHubService] No relay (EXPO_PUBLIC_API_URL) or DataHub config found. ` +
          `Running in LOCAL MOCK MODE for "${documentId}".`
      );
      return this.getFallbackMetadata(documentId);
    }

    console.log(`[DataHubService] Initiating metadata fetch for: ${documentId}`);

    try {
      const endpoint = buildGraphQLEndpoint(config.gmsUrl);

      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${config.patToken}`,
      };

      // Real DataHub GMS read: dataset search, then dataset detail enrichment.
      const searchResponse = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: SEARCH_QUERY,
          variables: {
            input: { type: 'DATASET', query: documentId, start: 0, count: 20 },
          },
        }),
      });

      if (!searchResponse.ok) {
        throw new Error(`DataHub responded with status: ${searchResponse.status}`);
      }

      const searchResult = await searchResponse.json();

      if (searchResult.errors) {
        console.error('[DataHubService] GraphQL Errors:', searchResult.errors);
        throw new Error('GraphQL query returned errors');
      }

      const results = searchResult.data?.search?.searchResults ?? [];
      const entities = results.map((result: any) => result?.entity).filter(Boolean);

      if (entities.length === 0) {
        throw new Error('DataHub returned no dataset results');
      }

      // Best-effort enrichment with the primary dataset description.
      let description = '';
      try {
        const detailResponse = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: DATASET_QUERY,
            variables: { urn: entities[0].urn },
          }),
        });
        const detail = await detailResponse.json();
        description = detail?.data?.dataset?.properties?.description ?? '';
      } catch (error) {
        console.warn('[DataHubService] Dataset detail enrichment skipped.', error);
      }

      console.log('[DataHubService] Successfully retrieved metadata from DataHub');
      return this.buildMetadataFromEntities(entities, description, documentId);
    } catch (error) {
      console.warn(
        `[DataHubService] DataHub connection failed. Falling back to local catalog.`,
        error
      );
      return this.getFallbackMetadata(documentId);
    }
  }

  /**
   * Fetch metadata through the EduAudio relay backend.
   * The relay owns DataHub credentials, so the mobile bundle never exposes them.
   */
  private async fetchViaRelay(apiUrl: string, documentId: string): Promise<EducationalMetadata> {
    const endpoint = `${apiUrl.replace(/\/+$/, '')}/api/datahub/query`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ documentId }),
    });

    if (!response.ok) {
      throw new Error(`Relay responded with status: ${response.status}`);
    }

    const result = await response.json();

    if (result.errors) {
      console.error('[DataHubService] Relay query errors:', result.errors);
      throw new Error('Relay query returned errors');
    }

    const doc = result.data?.document;
    if (!doc) {
      throw new Error('Relay returned an empty document payload');
    }

    console.log('[DataHubService] Successfully retrieved metadata via relay.');
    return this.normalizeDocument(doc, documentId);
  }

  /**
   * Normalize a raw DataHub/relay document payload into EducationalMetadata.
   */
  private normalizeDocument(doc: any, documentId: string): EducationalMetadata {
    return {
      documentId: doc.id ?? documentId,
      outline: doc.outline ?? [],
      headings: doc.headings ?? [],
      accessibility: {
        hasTranscript: doc.accessibility?.hasTranscript ?? true,
        hasAltText: doc.accessibility?.hasAltText ?? false,
        isScreenReaderOptimized: doc.accessibility?.isScreenReaderOptimized ?? true,
        isTalkBackOptimized: doc.accessibility?.isTalkBackOptimized ?? true,
        isVoiceOverOptimized: doc.accessibility?.isVoiceOverOptimized ?? true,
      },
    };
  }

  /**
   * Build EducationalMetadata from real DataHub dataset search results.
   * Matches the relay backend's outline/headings mapping in
   * server/services/DataHubService.ts.
   */
  private buildMetadataFromEntities(
    entities: any[],
    description: string,
    documentId: string
  ): EducationalMetadata {
    const docs = entities
      .map((entity) => ({
        id: String(entity?.urn ?? ''),
        title: String(entity?.name ?? entity?.properties?.name ?? entity?.urn ?? ''),
      }))
      .filter((doc) => doc.id || doc.title);

    return {
      documentId: docs[0]?.id ?? documentId,
      outline: docs.map((doc, index) => ({
        id: doc.id,
        title: doc.title,
        pageNumber: index + 1,
        level: 1,
        ...(description && index === 0 ? { description } : {}),
      })),
      headings: docs.map((doc, index) => ({
        level: 1,
        text: doc.title,
        position: index * 1000,
      })),
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
   * Logs a voice session telemetry write-back to the DataHub context graph.
   * Telemetry payloads are modeled by examples/datahub_telemetry_writeback.json.
   *
   * Routing: relay backend (EXPO_PUBLIC_API_URL) first, then direct DataHub,
   * then local no-op. When nothing is configured the call is a safe no-op:
   * it logs locally and resolves false without throwing.
   *
   * @param payload Raw telemetry object to persist
   * @returns Promise resolving to true when the write succeeded
   */
  public async recordTelemetry(payload: Record<string, unknown>): Promise<boolean> {
    const relay = resolveRelayConfig();

    if (relay.isConfigured) {
      try {
        const endpoint = `${relay.apiUrl.replace(/\/+$/, '')}/api/datahub/telemetry`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          console.warn(`[DataHubService] Relay telemetry write-back rejected: ${response.status}`);
          return false;
        }

        console.log('[DataHubService] Telemetry write-back recorded via relay.');
        return true;
      } catch (error) {
        console.warn('[DataHubService] Relay telemetry write-back failed:', error);
        return false;
      }
    }

    const config = resolveDataHubConfig();

    if (!config.isConfigured) {
      console.warn(
        '[DataHubService] No relay or DataHub config. Telemetry logged locally (no-op write-back).'
      );
      return false;
    }

    // Real DataHub GMS exposes no custom telemetry mutation; write-backs must
    // go through the relay backend (which uses the DataHub MCP Server tools).
    console.warn(
      '[DataHubService] Direct DataHub GMS has no custom telemetry mutation; ' +
        'configure EXPO_PUBLIC_API_URL to write back via the relay backend.'
    );
    return false;
  }

  /**
   * Verifies structural context before reading content aloud.
   * Can be used by useAITeacher to confirm if a paragraph aligns with the known outline.
   *
   * @param metadata The metadata catalog for the current document
   * @param pageNumber The page being read
   * @param paragraphText Snippet of text from the paragraph
   * @returns boolean indicating if context is verified
   */
  public verifyStructuralContext(
    metadata: EducationalMetadata,
    pageNumber: number,
    paragraphText: string
  ): boolean {
    console.log(`[DataHubService] Verifying structural context: Page ${pageNumber}`);

    // Check if paragraph aligns with any known headings on this page
    const matchingHeading = metadata.headings.find(h =>
      h.text.toLowerCase().includes(paragraphText.substring(0, 30).toLowerCase())
    );

    if (matchingHeading) {
      console.log(`[DataHubService] Context verified: Text aligns with heading "${matchingHeading.text}"`);
      return true;
    }

    // Verify if the page exists within the structural outline
    const existsInOutline = metadata.outline.some(item => item.pageNumber === pageNumber);

    if (existsInOutline) {
      console.log(`[DataHubService] Context verified: Page ${pageNumber} found in document outline`);
      return true;
    }

    console.warn(`[DataHubService] Structural mismatch: Page ${pageNumber} content could not be verified against outline.`);
    return false;
  }

  /**
   * Generates mock metadata for local development and error recovery
   */
  private getFallbackMetadata(documentId: string): EducationalMetadata {
    return {
      documentId,
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
}

// Export singleton instance
export const dataHubService = DataHubService.getInstance();
