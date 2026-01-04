# RefHunters Backend

**Agentic Research Assistant** - Multi-agent system for analyzing scientific papers with intelligent citation extraction and reference retrieval.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+, Docker (for GROBID), Redis, OpenAI API key.

### Installation & Run
```bash
npm install
cp .env.example .env # Add OPENAI_API_KEY
docker run -d --name grobid -p 8070:8070 lfoppiano/grobid:0.7.1
sudo systemctl start redis-server
npx tsx src/server.ts
```
*Server runs on `http://localhost:3001`*

---

## 🏗️ Architecture

The backend uses a **LangGraph** orchestrator to coordinate specialized agents:

- **Entry → Classify → Decompose → Planner → Dispatch → Exit**

### Agents
- **A0 (Orchestrator)**: Classifies queries, extracts keywords, and creates a single clarified question. *Note: A0 logic is distributed across modular nodes in `src/nodes/`. **Decomposer no longer splits queries** - it uses keywords from Brain to clarify a single question.*
- **A1 (Data)**: Uses GROBID to parse PDFs and arXiv API to fetch external references. Filters citations using keywords.
- **A2 (Writer)**: Synthesizes evidence into cited, expertise-aware answers.

---

## 📁 File Structure

```
src/
├── agents/    # A0, A1, A2 logic
├── nodes/     # LangGraph workflow nodes
├── utils/     # Task builders, executors, and vector search
├── config/    # workflow-config.ts
├── memory/    # Redis session management
├── server.ts  # Express entry point
└── index.ts   # Graph definition
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/query` | Primary Q&A endpoint |
| `POST` | `/api/upload` | PDF upload & session initialization |
| `POST` | `/api/feedback`| Collect user ratings |
| `GET` | `/api/session/:sessionId` | Retrieve session history |

---

## 🛠️ How It Works (Simplified)

1.  **Understand**: Query is classified (QA/Compare) and broken down if complex.
2.  **Retrieve (A1)**: Citations are extracted from the main paper; external PDFs are downloaded from arXiv.
3.  **Synthesize (A2)**: All evidence is ranked by relevance and synthesized into a cited answer.

---

## 🔧 Configuration

### Environment (.env)
- `OPENAI_API_KEY`, `GROBID_URL`, `PORT` (default: 3000).

### Workflow Config
Adjust `src/config/workflow-config.ts` for iteration limits and retrieval depth.

---

## 📚 Further Reading
- **[System Architecture](./SYSTEM_ARCHITECTURE.md)** - Detailed design and logic flow.

---

**Maintained by:** RefHunters Team  
**Last Updated:** January 4, 2026
