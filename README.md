# 🎧 EduAudio

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Live Web App](https://img.shields.io/badge/Live_App-eduaudio.onrender.com-brightgreen)](https://eduaudio.onrender.com)
[![Backend API](https://img.shields.io/badge/Backend_API-eduaudio--backend.onrender.com-blue)](https://eduaudio-backend.onrender.com/api/health)
[![DataHub MCP](https://img.shields.io/badge/DataHub_MCP-Integrated-orange)]()

> **Voice-first, accessible educational tutor for blind and visually impaired students.**  
> Powered by the **DataHub MCP Server** to index, validate, and catalog structured educational content with live voice telemetry write-backs.

---

### 📌 Hackathon Entry Details
* **Challenge Category:** **Agents That Do Real Work** / **Open (Wildcard)**
* **Core DataHub Integration:** Reads educational catalog context via DataHub MCP (`search_documents` → `search` → `get_entities`), executes interactive voice tutoring, and writes back student performance telemetry (`save_document` + `update_description`).
* **License:** Apache 2.0 (See [LICENSE](LICENSE))

---

## 🎧 Overview

EduAudio transforms static educational materials into dynamic, voice-interactive learning sessions. Designed specifically for students with vision loss, it combines high-quality text-to-speech, real-time voice recognition, and AI-driven context awareness to provide a conversational tutoring experience that adheres to strict **WCAG 2.2 AAA** accessibility standards.

---

## ✨ Core Features

* **AI Interactive Teacher Mode:** A conversational tutor where students can talk to their lesson materials, ask questions, and receive context-aware explanations hands-free.
* **Hands-Free Keyboard & Voice PTT:** Full WCAG AAA keyboard accessibility using **Spacebar / 'M' key** Push-To-Talk with Web Audio dual-tone chimes (rising tone on mic open, falling tone on mic close) and `aria-live="polite"` real-time screen-reader updates.
* **Auto-Voice Onboarding:** Zero-touch startup that automatically speaks a vocal welcome greeting and reads Page 1 out loud upon activating the AI Teacher view.
* **DataHub Metadata Catalog Engine:** Integrates with DataHub instances via MCP to fetch structured outlines, course headings, and accessibility metadata (transcripts, alt-text flags).
* **Automated Telemetry Write-Back:** Captures voice session progress, auto-flushes aggregated knowledge insight documents to DataHub every 10 sessions, and mutates descriptions on `DATAHUB_LESSON_URN`.
* **Audio Mutex Management:** Concurrency control preventing output speech, user mic input, and system screen readers (VoiceOver/TalkBack) from clashing.
* **Resilient 3-Tier Fallback Engine:** Guarantees zero application crashes by gracefully degrading across **MCP Server → Direct GMS GraphQL → Offline Local Mock**.

---

## 🛠️ Tech Stack

* **Frontend:** React Native / Expo (TypeScript, Expo Web SPA)
* **State Management:** Finite State Machine (FSM) via React Context
* **AI & Audio Engine:** OpenAI API, `expo-speech` (TTS), `webkitSpeechRecognition` (STT), Web Audio API (Chimes)
* **Metadata Graph:** DataHub (DataHub MCP Server + GMS GraphQL API)
* **Accessibility:** WCAG 2.2 AAA Compliance, `expo-haptics`

---

## 🏆 DataHub Context Read & Write-Back Architecture

EduAudio operates a complete bi-directional data flow with the DataHub knowledge graph:

```text
[ EduAudio Client ] 
        │
        ▼ (POST /api/datahub/query & /telemetry)
[ Relay Backend ]
        │
        ├─► Tier 1: DataHub MCP Server (search_documents ➔ save_document)
        ├─► Tier 2: DataHub GMS GraphQL (SEARCH_QUERY ➔ Dataset Entities)
        └─► Tier 3: Offline Local Mock (Zero-network fail-safe)
