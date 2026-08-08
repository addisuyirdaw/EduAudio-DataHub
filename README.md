# 🎧 EduAudio — Voice-First AI Tutor Powered by DataHub

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Live Web App](https://img.shields.io/badge/Live_App-eduaudio.onrender.com-brightgreen)](https://eduaudio.onrender.com)
[![Backend API](https://img.shields.io/badge/Backend_API-eduaudio--backend.onrender.com-blue)](https://eduaudio-backend.onrender.com/api/health)
[![DataHub MCP](https://img.shields.io/badge/DataHub_MCP-integrated-orange)](examples/datahub_mcp_tool_calls.json)

> **Voice-first, accessible educational tutor for blind and visually impaired students.**
> An AI agent that reads DataHub's context graph to understand *what's connected to what*, runs hands-free voice tutoring sessions, and writes student telemetry back so the next person or agent inherits the knowledge.

---

## 📌 Hackathon Entry

* **Challenge Category:** **Agents That Do Real Work**
* **Core DataHub Integration:** The agent reads the educational catalog through the **DataHub MCP Server** (`search_documents` → `search` → `get_entities`), executes interactive voice tutoring, and contributes back to the graph — per-session telemetry Documents via `save_document`, a governance mutation via `update_description`, and auto-flushed aggregate insights every 10 sessions.
* **License:** Apache 2.0 (see [LICENSE](LICENSE))

**One-line pitch:** *"A tutor agent for students with vision loss that reads DataHub for real lesson structure before it speaks, listens hands-free, and writes every session back into DataHub so the next agent knows what happened."*

---

## 🎯 Why This Is an "Agent That Does Real Work"

The agent isn't a chat wrapper — it closes a loop with the data platform:

1. **Reads real context from DataHub.** Before tutoring, it queries the DataHub MCP Server for the lesson catalog, outlines, headings, and accessibility metadata (transcripts, alt-text, screen-reader flags) via `search_documents`, `search`, and `get_entities`. It knows the document's true structure — not a hardcoded guess.
2. **Takes action.** It navigates the lesson hands-free using voice commands ("go to page twelve", "read chapter three", "what is wave-particle duality?"), guarded by an audio mutex so TTS, mic input, and system screen readers never clash.
3. **Writes results back.** Each session becomes a knowledge Document in DataHub (`save_document`). The lesson Dataset's description is appended with the latest engagement (`update_description`, a real governance contribution). After every 10 sessions, aggregated insights (intents, outcomes, durations, failures) are auto-flushed to DataHub so **the next person or agent inherits the knowledge**.

This is a genuine read → act → write-back agent, not a metadata browser.

---

## ✨ Core Features

* **AI Interactive Teacher Mode:** A conversational tutor where students talk to their lesson materials, ask questions, and get context-aware explanations — fully hands-free.
* **Hands-Free Keyboard & Voice PTT:** Full WCAG AAA keyboard accessibility using **Spacebar / 'M' key** Push-To-Talk with Web Audio dual-tone chimes (rising on mic open, falling on mic close) and `aria-live="polite"` real-time screen-reader updates.
* **Auto-Voice Onboarding:** Zero-touch startup that speaks a vocal welcome and reads Page 1 aloud on entering AI Teacher view.
* **DataHub Metadata Catalog Engine:** Pulls structured outlines, course headings, and accessibility metadata from DataHub via the MCP Server (GraphQL GMS fallback).
* **Automated Telemetry Write-Back:** Captures voice session progress, writes per-session Documents, mutates the lesson Dataset description on `DATAHUB_LESSON_URN`, and auto-flushes aggregated insights every 10 sessions.
* **Audio Mutex Management:** Concurrency control preventing output speech, mic input, and system screen readers (VoiceOver/TalkBack) from clashing.
* **Resilient 3-Tier Fallback Engine:** Guarantees zero app crashes by degrading gracefully across **MCP Server → Direct GMS GraphQL → Offline Local Mock**.

---

## 🏆 DataHub Context Read & Write-Back Architecture

EduAudio operates a complete bi-directional data flow with the DataHub knowledge graph:

```text
[ EduAudio Client (React Native / Expo) ]
        │
        ▼  POST /api/datahub/query  &  /api/datahub/telemetry
[ Relay Backend (Express) ]
        │
        ├─► Tier 1: DataHub MCP Server
        │     READ : search_documents → search → get_entities
        │     WRITE: save_document → update_description → flushInsights (every 10 sessions)
        ├─► Tier 2: DataHub GMS GraphQL (SEARCH_QUERY → DATASET_QUERY)
        └─► Tier 3: Offline Local Mock (zero-network fail-safe)
```

**Detailed example MCP conversation** — every read and write the agent performs, with realistic tool call arguments and responses: [`examples/datahub_mcp_tool_calls.json`](examples/datahub_mcp_tool_calls.json).

---

## 📁 Sample Outputs (Judge-Ready, No Setup Required)

Every artifact EduAudio produces is captured in `examples/` so you can evaluate output quality without running anything:

| File | What it shows |
|------|---------------|
| [`examples/datahub_mcp_tool_calls.json`](examples/datahub_mcp_tool_calls.json) | Full MCP Server conversation: reads + telemetry + insight write-backs |
| [`examples/datahub_telemetry_writeback.json`](examples/datahub_telemetry_writeback.json) | A complete voice-session telemetry payload persisted to DataHub |
| [`examples/datahub_metadata_response.json`](examples/datahub_metadata_response.json) | The catalog context the agent reads (outline, headings, accessibility) |
| [`examples/datahub_schema_response.json`](examples/datahub_schema_response.json) | Real DataHub schema metadata for the lessons catalog |

---

## 🛠️ Tech Stack

* **Frontend:** React Native / Expo (TypeScript, Expo Web SPA)
* **State Management:** Finite State Machine (FSM) via React Context
* **AI & Audio Engine:** OpenAI API, `expo-speech` (TTS), `@react-native-voice` / webkitSpeechRecognition (STT), Web Audio API (chimes)
* **Metadata Graph:** DataHub (DataHub MCP Server + GMS GraphQL API)
* **Backend Relay:** Express + TypeScript (`tsx`)
* **Accessibility:** WCAG 2.2 AAA Compliance (7:1 contrast, 55dp touch targets, live regions), `expo-haptics`

---

## 🚀 Quickstart

The app degrades to offline mock mode with zero configuration, but to see it talk to real DataHub you need to (a) spin up DataHub, (b) seed the catalog, and (c) run the relay + app.

### 0. Prerequisites

* Node.js 20+
* A running DataHub instance (see the [DataHub Quickstart](https://datahubproject.io/docs/quickstart)) — or use the DataHub MCP Server
* (Optional) An OpenAI API key for the AI teacher responses

### 1. Install dependencies

```bash
npm install
```

### 2. Spin up DataHub locally

Follow the [DataHub Quickstart](https://datahubproject.io/docs/quickstart) to get a local GMS on `http://localhost:8080`.

### 3. Seed the educational catalog into DataHub

```bash
DATAHUB_GMS_URL=http://localhost:8080 npx tsx server/scripts/seedDatahub.ts
```

This ingests a `Domain`, the `EduAudio Lessons Catalog` Dataset, three course Datasets, and full schema metadata (headings + accessibility custom properties) via DataHub's batch ingest REST endpoint.

### 4. Run the backend relay

```bash
# DataHub MCP Server path (recommended)
DATAHUB_MCP_COMMAND=uvx DATAHUB_MCP_ARGS="mcp-server-datahub@latest" \
DATAHUB_GMS_URL=http://localhost:8080 \
DATAHUB_LESSON_URN="urn:li:dataset:(urn:li:dataPlatform:custom,lessons,PROD)" \
npm run server

# — or — direct DataHub GMS GraphQL path
DATAHUB_GMS_URL=http://localhost:8080 DATAHUB_PAT_TOKEN=<your-token> npm run server
```

Verify the health probe: `GET http://localhost:3001/api/health` → `{ "status": "ok", "datahubMode": "mcp" | "datahub" | "mock", ... }`

### 5. Run the app

```bash
# Terminal 1 — Expo (web preview, no emulator needed)
npm run web

# or on a device/emulator
npm start
```

Set `EXPO_PUBLIC_API_URL` (e.g. `http://localhost:3001`) so the client routes through the relay. That's it — open the AI Teacher view and it reads real DataHub metadata.

### Optional: connect via the DataHub MCP Server over HTTP

```bash
DATAHUB_MCP_URL=http://<host>/mcp DATAHUB_MCP_TOKEN=<token> npm run server
```

---

## ⚙️ Environment Variables

### Backend relay (`server/`)

| Variable | Description | Default |
|----------|-------------|---------|
| `DATAHUB_MCP_URL` | Streamable HTTP endpoint of the DataHub MCP Server | — |
| `DATAHUB_MCP_COMMAND` | Stdio command that launches the MCP server (e.g. `uvx`) | — |
| `DATAHUB_MCP_ARGS` | Space-separated args (e.g. `mcp-server-datahub@latest`) | — |
| `DATAHUB_MCP_TOKEN` | Optional bearer token for the HTTP endpoint | — |
| `DATAHUB_GMS_URL` | DataHub GMS base origin | `http://localhost:8080` |
| `DATAHUB_PAT_TOKEN` | DataHub Personal Access Token | — |
| `DATAHUB_LESSON_URN` | Lesson Dataset URN used for `update_description` write-backs | — |
| `PORT` | Relay port | `3001` |

### Frontend (`src/`)

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_API_URL` | Base origin of the relay backend (inlined at build time) |
| `EXPO_PUBLIC_DATAHUB_GMS_URL` | Direct GMS fallback origin (no relay) |
| `EXPO_PUBLIC_DATAHUB_PAT_TOKEN` | PAT for direct GMS fallback |

### Resolution order

* **Client:** Relay (`EXPO_PUBLIC_API_URL`) → Direct DataHub GraphQL → Local Mock
* **Relay:** DataHub MCP Server → DataHub GMS GraphQL → Local Mock

---

## 🧪 Testing

```bash
npm run typecheck        # TypeScript type check
npm run server           # start the backend relay
npm run seed:datahub     # seed the catalog into a running DataHub GMS
```

**API endpoints:**
* `GET  /api/health` — liveness + current DataHub mode probe
* `POST /api/datahub/query` — fetch document context (body: `{ "documentId": "..." }`)
* `POST /api/datahub/telemetry` — write voice-session telemetry
* `GET  /api/datahub/insights` — current aggregated session insights
* `POST /api/datahub/insights/flush` — force-flush insights to DataHub

**Live deployments:**
* Web app: [eduaudio.onrender.com](https://eduaudio.onrender.com)
* Backend health: [eduaudio-backend.onrender.com/api/health](https://eduaudio-backend.onrender.com/api/health)

---

## 🎬 Demo Video

> **TODO:** Link your <3 minute demo video (YouTube/Vimeo/Youku). Show: the app speaking the welcome, a voice "go to page twelve" navigation, an AI question answered hands-free, and the session telemetry appearing in DataHub.

---

## 📁 Project Structure

```
├── server/                  # Express backend relay (owns DataHub credentials)
│   ├── index.ts             # API routes: query / telemetry / insights / health
│   ├── services/
│   │   ├── DataHubService.ts   # MCP → GraphQL → Mock orchestration
│   │   └── datahubMcpClient.ts # MCP JSON-RPC client (stdio + HTTP)
│   └── scripts/seedDatahub.ts  # Seed the lesson catalog into DataHub
├── src/                     # React Native / Expo client
│   ├── context/             # TeacherContext (7-state FSM) + AudioMutex
│   ├── hooks/               # useAITeacher, useTextToSpeech, useVoiceRecognition, ...
│   ├── services/            # DataHubService, pdfParser, persistence, voice commands
│   └── components/          # AITeacherScreen, FullScreenPTT, StatusIndicator, ...
└── examples/                # Sample outputs (MCP calls, telemetry, metadata, schema)
```

---

## 🌟 Why Judges Should Care

* **Real write-backs, not just reads.** The agent contributes back to the DataHub graph: per-session Documents, a lesson-level `update_description` governance mutation, and aggregated insights that the *next* agent inherits.
* **Solves a real problem.** 250M+ people live with vision impairment; standard educational content is not accessible to them. EduAudio turns static documents into fully voice-navigable lessons with verifiable structure from DataHub.
* **Production-minded engineering.** 3-tier graceful degradation, audio mutex concurrency control, WCAG 2.2 AAA compliance, TypeScript end-to-end, and a documented API contract.
* **Self-contained and testable.** Sample outputs, live deployments, one-command seeding, and full setup docs mean a judge can verify the claim without fighting the toolchain.

---

## 📄 License

This project is licensed under the [Apache License 2.0](LICENSE).

---

## 🙏 Acknowledgements

Built for the **Build with DataHub: The Agent Hackathon** using the [DataHub](https://datahubproject.io) open-source platform and its **MCP Server**.
