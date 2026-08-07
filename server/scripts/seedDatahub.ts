/**
 * server/scripts/seedDatahub.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Seed the EduAudio lesson catalog into a real DataHub GMS so the relay's
 * real GraphQL reads (SEARCH_QUERY / DATASET_QUERY) and the DataHub MCP
 * Server tool calls have entities to find.
 *
 * Uses DataHub's modern batch ingest REST endpoint:
 *   POST {GMS}/api/entities/v1?action=create
 *   X-RestLi-Protocol-Version: 2.0.0
 *   body: [ { entityType, entityUrn, aspectName, aspectValue }, ... ]
 *
 * Environment:
 *   DATAHUB_GMS_URL      DataHub GMS base origin (default http://localhost:8080)
 *   DATAHUB_PAT_TOKEN    Personal Access Token (optional for local quickstart)
 *
 * Run:
 *   DATAHUB_GMS_URL=http://localhost:8080 npx tsx server/scripts/seedDatahub.ts
 *
 * After seeding, point the relay at the same GMS (DATAHUB_GMS_URL +
 * DATAHUB_PAT_TOKEN) or at the DataHub MCP Server (DATAHUB_MCP_URL /
 * DATAHUB_MCP_COMMAND) and the app reads real metadata.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const GMS_URL = (process.env.DATAHUB_GMS_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
const PAT_TOKEN = (process.env.DATAHUB_PAT_TOKEN ?? '').trim();
const ENDPOINT = `${GMS_URL}/api/entities/v1?action=create`;

const ACTOR = 'urn:li:corpuser:datahub';
const DOMAIN_URN = 'urn:li:domain:education';
const now = Date.now();

interface IngestItem {
  entityType: string;
  entityUrn: string;
  aspectName: string;
  aspectValue: Record<string, unknown>;
}

const catalog: Array<{
  urn: string;
  name: string;
  description: string;
  customProperties: Record<string, string>;
}> = [
  {
    urn: 'urn:li:dataset:(urn:li:dataPlatform:custom,lessons,PROD)',
    name: 'EduAudio Lessons Catalog',
    description:
      'Master catalog of EduAudio lessons. 42 lessons, 12 accessible transcripts, all screen-reader optimized. Outlines and headings are stored in customProperties for the mobile voice app.',
    customProperties: {
      'headings': 'Preface;Chapter 1: Educational Foundations;1.1 Accessibility Standards;Conclusion',
      'accessibility': 'hasTranscript=true,hasAltText=false,isScreenReaderOptimized=true,isTalkBackOptimized=true,isVoiceOverOptimized=true',
      'lessonCount': '42',
    },
  },
  {
    urn: 'urn:li:dataset:(urn:li:dataPlatform:custom,edu_intro_cognitive_psychology,PROD)',
    name: 'Introduction to Cognitive Psychology',
    description:
      'Chapter 3: Memory & Learning - encoding, storage, retrieval, and accessibility profiles for every section.',
    customProperties: {
      'headings': 'Encoding;Storage;Retrieval;Forgetting;Accessibility Profiles',
      'accessibility': 'hasTranscript=true,isScreenReaderOptimized=true,isTalkBackOptimized=true',
      'courseCode': 'PSYC-101',
    },
  },
  {
    urn: 'urn:li:dataset:(urn:li:dataPlatform:custom,edu_quantum_mechanics_101,PROD)',
    name: 'Quantum Mechanics 101',
    description:
      'Foundational quantum mechanics lessons with text-to-speech transcripts and screen-reader friendly equations.',
    customProperties: {
      'headings': 'Wave Functions;Observables;Superposition;Entanglement',
      'accessibility': 'hasTranscript=true,isScreenReaderOptimized=true,isVoiceOverOptimized=true',
      'courseCode': 'PHYS-201',
    },
  },
];

function datasetProperties(name: string, description: string, customProperties: Record<string, string>) {
  return {
    name,
    description,
    customProperties,
  };
}

function ownership() {
  return {
    owners: [{ owner: ACTOR, type: 'DATAOWNER' }],
    lastModified: { time: now, actor: ACTOR },
  };
}

function domains() {
  return {
    domains: [DOMAIN_URN],
    lastModified: { time: now, actor: ACTOR },
  };
}

function schemaMetadata() {
  return {
    schemaName: 'lessons',
    platform: 'urn:li:dataPlatform:custom',
    version: 0,
    created: { time: now, actor: ACTOR },
    lastModified: { time: now, actor: ACTOR },
    hash: 'lessons-v1',
    platformSchema: {
      'com.linkedin.schema.MySqlDDL': {
        tableSchema: 'lesson_id VARCHAR, title VARCHAR, headings JSON, accessibility JSON',
      },
    },
    fields: [
      {
        fieldPath: 'lesson_id',
        description: 'Stable identifier for the lesson',
        nativeDataType: 'string',
        nullable: false,
        type: { type: { 'com.linkedin.schema.StringType': {} } },
      },
      {
        fieldPath: 'title',
        description: 'Human-readable lesson title',
        nativeDataType: 'string',
        nullable: false,
        type: { type: { 'com.linkedin.schema.StringType': {} } },
      },
      {
        fieldPath: 'headings',
        description: 'Outline headings used by the voice navigation',
        nativeDataType: 'json',
        nullable: true,
        type: { type: { 'com.linkedin.schema.ArrayType': { nestedType: ['string'] } } },
      },
      {
        fieldPath: 'accessibility',
        description: 'Accessibility feature flags (transcript, screen reader, talkback, voiceover)',
        nativeDataType: 'json',
        nullable: true,
        type: { type: { 'com.linkedin.schema.MapType': {} } },
      },
    ],
  };
}

function buildIngestItems(): IngestItem[] {
  const items: IngestItem[] = [
    {
      entityType: 'domain',
      entityUrn: DOMAIN_URN,
      aspectName: 'domainProperties',
      aspectValue: { name: 'Education', description: 'EduAudio accessible education catalog' },
    },
  ];

  for (const entry of catalog) {
    items.push(
      { entityType: 'dataset', entityUrn: entry.urn, aspectName: 'datasetProperties', aspectValue: datasetProperties(entry.name, entry.description, entry.customProperties) },
      { entityType: 'dataset', entityUrn: entry.urn, aspectName: 'ownership', aspectValue: ownership() },
      { entityType: 'dataset', entityUrn: entry.urn, aspectName: 'domains', aspectValue: domains() }
    );
  }

  // Schema metadata for the master catalog dataset only (rich detail view).
  items.push({
    entityType: 'dataset',
    entityUrn: catalog[0].urn,
    aspectName: 'schemaMetadata',
    aspectValue: schemaMetadata(),
  });

  return items;
}

async function main(): Promise<void> {
  const items = buildIngestItems();

  console.log(`[seed] Seeding ${items.length} aspects into ${ENDPOINT}`);
  if (PAT_TOKEN) console.log('[seed] Authenticated with DATAHUB_PAT_TOKEN');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-RestLi-Protocol-Version': '2.0.0',
  };
  if (PAT_TOKEN) headers.Authorization = `Bearer ${PAT_TOKEN}`;

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(items),
  });

  const raw = await response.text();

  if (!response.ok) {
    console.error(`[seed] Ingestion failed (${response.status}): ${raw.slice(0, 500)}`);
    process.exit(1);
  }

  console.log('[seed] Ingestion accepted. Response:');
  console.log(raw);

  console.log('\n[seed] Done. Verify with:');
  console.log(
    `  curl -X POST ${GMS_URL}/api/graphql -H 'Content-Type: application/json' ` +
      `-d '{"query":"query SearchCourses($input: SearchInput!) { search(input: $input) { total searchResults { entity { ... on Dataset { urn name properties { name description } } } } } }","variables":{"input":{"type":"DATASET","query":"lessons","start":0,"count":20}}}'`
  );
}

main().catch((error) => {
  console.error('[seed] Unexpected error:', error);
  process.exit(1);
});
