# EduAudio

> **Voice-first, accessible educational tutor for blind and visually impaired students.** 
> Powered by DataHub MCP to index, validate, and catalog structured educational content for interactive learning.

---

## 🎧 Overview

**EduAudio** transforms static educational materials into dynamic, voice-interactive learning sessions. Designed specifically for students with vision loss, it combines high-quality text-to-speech, real-time voice recognition, and AI-driven context awareness to provide a conversational tutoring experience that adheres to strict **WCAG 2.2 AAA accessibility standards**.

---

## ✨ Core Features

*   **AI Interactive Teacher Mode**: A conversational PDF tutor where students can "talk" to their documents, ask questions, and receive context-aware explanations.
*   **DataHub Metadata Catalog Engine**: Integrates with local DataHub instances to fetch structured outlines, topic headings, and accessibility metadata (transcripts, alt-text flags).
*   **Audio Mutex Management**: Custom concurrency control that prevents conflicts between the tutor's voice, the student's input, and system screen readers (VoiceOver/TalkBack).
*   **Structural Verification**: Validates reading content against the document's official structural outline to ensure high-quality educational context without hallucinations.
*   **Voice-First Interface**: Ultra-accessible design featuring full-screen "Push-to-Talk" (PTT) interaction and haptic/audio feedback chimes for all state transitions.

---

## 🛠️ Tech Stack

*   **Framework**: React Native / Expo (TypeScript)
*   **State Management**: Finite State Machine (FSM) via React Context
*   **AI/Voice**: OpenAI API, `expo-speech` (TTS), `@react-native-voice/voice` (STT)
*   **Metadata Graph**: DataHub (DataHub MCP Server + GMS GraphQL API)
*   **Accessibility**: WCAG 2.2 AAA Compliance, `expo-haptics`

---

## 📂 Project Structure

*   `src/context/`: Core FSM logic (`TeacherContext`) and `AudioMutex`.
*   `src/services/`: `DataHubService` (Metadata engine), PDF parsing, and audio feedback.
*   `src/hooks/`: Modular logic for voice recognition, TTS, and the AI Teacher interface.
*   `src/components/`: Accessible, high-contrast UI components with semantic ARIA roles.
*   `examples/`: Sample DataHub metadata schemas and API responses.

---

## 🚀 Quickstart

### Prerequisites
*   Node.js (v18+)
*   Expo Go app on your mobile device
*   Local DataHub instance (optional, fallback data included)

### Setup
1.  **Clone the Repository**
    ```bash
    git clone https://github.com/addisuyirdaw/EduAudio.git
    cd EduAudio/EduAudio
    ```
2.  **Install Dependencies**
    ```bash
    npm install
    ```
3.  **Start the Development Server**
    ```bash
    npx expo start
    ```

---

## 🏆 Hackathon Evaluation & Quickstart

### 1. How the DataHub Context Read / Write-Back Operates

EduAudio uses a three-tier metadata pipeline:

1. **Mobile App** — `src/services/DataHubService.ts` resolves the active backend in order:
   relay (`EXPO_PUBLIC_API_URL`) → direct DataHub (`EXPO_PUBLIC_DATAHUB_GMS_URL` +
   `EXPO_PUBLIC_DATAHUB_PAT_TOKEN`) → **local mock mode**.
2. **Relay Backend** — `server/index.ts` owns the DataHub credentials so the client
   bundle never ships secrets. It exposes:
   - `POST /api/datahub/query` — reads dataset/course context and returns
     `{ data: { document: {...} }, metadata: {...} }` (metadata carries `source`,
     `version`, and the MCP tool used).
   - `POST /api/datahub/telemetry` — accepts voice-session telemetry write-backs and
     returns `{ accepted, telemetryId, source, datahubWriteBack }`.
   - `GET /api/datahub/insights` — the aggregated in-memory session insights window.
   - `POST /api/datahub/insights/flush` — flush the aggregated insights back to DataHub
     as a knowledge Document (also auto-flushed every 10 sessions).
   - `GET /api/health` — liveness probe plus the active `datahubMode`.
3. **DataHub** — the context graph. Reads and write-backs are attempted through the
   **DataHub MCP Server** first (`search_documents` → `search` → `get_entities`,
   write-backs via `save_document` + `update_description`), then the **real GMS GraphQL
   API** (`search` + `dataset`), then **local mock data**. See
   `examples/datahub_mcp_tool_calls.json` for the exact tool sequence.

```text
Resolution order:  MCP Server  ->  DataHub GMS GraphQL  ->  LOCAL MOCK
                   (never throws on any upstream failure)
```

**Mock fallback guarantee:** when no relay or DataHub configuration exists,
`fetchMetadata` returns offline catalog data without issuing a single network
request, so the app cannot crash from a missing backend.

### 1b. Seed Real Data into DataHub

```bash
DATAHUB_GMS_URL=http://localhost:8080 npx tsx server/scripts/seedDatahub.ts
# or: npm run seed:datahub
```

Creates the EduAudio lesson catalog (Datasets with `datasetProperties`, `ownership`,
`domains`, and `schemaMetadata`) plus the `urn:li:domain:education` Domain through
DataHub's batch ingest endpoint (`POST /api/entities/v1?action=create`). Point the
relay at the same GMS (`DATAHUB_GMS_URL` + `DATAHUB_PAT_TOKEN`) or at the DataHub MCP
Server (`DATAHUB_MCP_URL` / `DATAHUB_MCP_COMMAND` + `DATAHUB_LESSON_URN`) and the app
reads real metadata end-to-end.

### 2. Install & Test the Android APK

Prerequisites: Node 18+, an Android device or emulator, and the Expo Go app (or EAS CLI).

```bash
npm install --legacy-peer-deps
npx tsc --noEmit          # verify zero type errors
npm start                 # start the Expo dev server
```

Scan the QR code with Expo Go, or build a standalone APK:

```bash
npx eas build -p android --profile preview
```

Once built, sideload the APK on the device, grant microphone permission, then run
the AI Teacher flow: touch & hold anywhere → speak → release to send the command.

### 3. Backend Endpoints & `examples/` Overview

The `examples/` directory contains the sample DataHub payloads used during evaluation:

*   `examples/datahub_mcp_tool_calls.json` — the exact DataHub MCP Server tool sequence for reads + write-backs.
*   `examples/datahub_schema_response.json` — dataset/audio-course schema metadata read from DataHub.
*   `examples/datahub_metadata_response.json` — document outline + accessibility metadata GraphQL response.
*   `examples/datahub_telemetry_writeback.json` — raw voice-session telemetry write-back payload.

Run the relay locally:

```bash
npm run server
```

Then exercise the endpoints:

```bash
curl http://localhost:3001/api/health
curl -X POST http://localhost:3001/api/datahub/query \
  -H "Content-Type: application/json" \
  -d '{"documentId":"edu-doc-7721-phys-101"}'
curl -X POST http://localhost:3001/api/datahub/telemetry \
  -H "Content-Type: application/json" \
  -d @examples/datahub_telemetry_writeback.json
curl http://localhost:3001/api/datahub/insights
curl -X POST http://localhost:3001/api/datahub/insights/flush
```

To point the mobile app at a deployed relay, create a `.env.local` file:

```
EXPO_PUBLIC_API_URL=https://eduaudio.onrender.com
```

Live deployments:

*   Frontend (web SPA): `https://eduaudio.onrender.com`
*   Backend relay: `https://eduaudio-backend.onrender.com` (`/api/health`)

---

## 📑 Documentation
For deeper technical insights, see our implementation guides:
*   [AI Teacher Implementation Plan](./AI_TEACHER_IMPLEMENTATION_PLAN.md)
*   [FSM & Voice Integration](./FSM_VOICE_INTEGRATION_IMPLEMENTATION.md)
*   [Implementation Summary](./IMPLEMENTATION_SUMMARY.md)
*   [DataHub Metadata Example](./examples/datahub_metadata_response.json)
