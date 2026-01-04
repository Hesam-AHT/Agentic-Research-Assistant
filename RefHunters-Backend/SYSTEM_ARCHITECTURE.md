# RefHunters - System Architecture

**Version:** 3.0 | **Last Updated:** Jan 4, 2026

RefHunters uses a multi-agent workflow orchestrated by **LangGraph** to analyze research papers.

---

## 🏗️ Architecture Overview

```mermaid
graph TD
    User --> BE[Backend Server]
    BE --> LG[LangGraph Orchestrator]
    
    subgraph Workflow
        Nodes[Entry → Classify → Decompose → Planner → Dispatch → Exit]
    end
    
    Dispatch --> A1[Agent A1: Data]
    Dispatch --> A2[Agent A2: Writer]
    
    A1 --> PD[GROBID / arXiv]
    A2 --> GPT[GPT-4 Synthesis]
```

---

## 🤖 Agent Profiles

### Agent A0 (Controller)
*Distributed across modular nodes in `src/nodes/`.*
- **Brain**: Classifies query type (QA/Compare/Explain), complexity, and **extracts keywords** for filtering.
- **Decomposer**: **SIMPLIFIED** - No longer splits queries. Creates a single clarified question using Brain's keywords.
- **Planner**: Builds a single `retrieve` task (A1) and one `reason` task (A2).

### Agent A1 (Data & Evidence)
*Handles information acquisition in `a1.ts`.*
- **Tools**:GROBID PDF parsing, arXiv search, PDF download.
- **Workflow**: Extracts citations from main paper → Searches arXiv for full references → Chunks PDFs into evidence.
- **Iteration**: Stops once valid reference PDFs are acquired (max 15 iterations).

### Agent A2 (Answer Writer)
*Handles final synthesis in `a2.ts`.*
- **Tools**: Evidence analysis and response synthesis.
- **Rule**: ONLY use provided evidence chunks.
- **Output**: Generates formatted markdown answers with inline citations `[0]`, `[1]`.

---

## ⚙️ Core Modules

### 1. LangGraph Nodes (`src/nodes/`)
Decoupled logic for each stage of the workflow (Entry, Classify, etc.).

### 2. Utilities (`src/utils/`)
- **TaskBuilder**: Standardizes task objects for A1/A2.
- **TaskExecutor**: Handles agent loops and tool execution.
- **EvidenceAggregator**: Consolidates all retrieved evidence into a unified vector store.
- **SessionVectorStore**: Local semantic search with cosine similarity and main-paper boosting.

---

## 🔄 Technical Data Flow

1.  **Entry**: Session state is restored from **Redis**. Chat history is loaded.
2.  **Classify (Brain)**: Query is analyzed for task type, complexity, and **keywords are extracted**.
3.  **Decompose**: **Simplified** - Single clarified question is created (no sub-questions).
4.  **Plan**: Single A1 retrieve task is created with **all keywords** from Brain.
5.  **Discovery (A1)**: Agent uses keywords to filter citations and retrieve relevant PDFs from arXiv.
6.  **Ranking**: `EvidenceAggregator` ranks all chunks by semantic relevance to the query.
7.  **Synthesis (A2)**: Writer generates answer using top-ranked evidence chunks.
8.  **Exit**: Results and conversation history are saved to Redis.

---

## 🔧 Workflow Configuration

Constants are centralized in `workflow-config.ts`:
- `maxA1Iterations`: 15
- `maxA2Iterations`: 10
- `topN` (Bibliography Filtering):
    - `default`: 12 (Citations checked for standard Q&A)
    - `summary`: 2 (Citations checked in summary mode)
- `topK` (Content Chunks):
    - `default`: 8 (Chunks kept per reference paper)
    - `semanticSearch`: 35 (Total chunks sent to Writer)

---

**Maintained by:** RefHunters Team  
**Architecture Source**: `RefHunters-Backend/src/index.ts`
