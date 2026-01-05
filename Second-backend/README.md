# RefHunters - Backend

The backend is the "brain" of RefHunters - a multi-agent system that processes research papers and answers questions using AI.

## What Does It Do?

The backend handles:
- **PDF Processing**: Extracts text and citations from research papers
- **Smart Question Answering**: Uses 3 AI agents to understand, research, and answer your questions
- **Citation Management**: Finds and downloads related papers from arXiv
- **Session Memory**: Remembers your conversation context

## Architecture

The system uses **3 specialized AI agents**:

### Agent 0 (A0) - Coordinator
- Receives your questions
- Extracts keywords and classifies query type
- Coordinates the other agents

### Agent 1 (A1) - Evidence Collector
- Extracts citations from your PDF using GROBID
- Searches arXiv for related papers
- Downloads papers and builds a knowledge base
- Tracks exact locations (paragraph, line, sentence) in the paper

### Agent 2 (A2) - Answer Generator
- Analyzes evidence from A1
- Synthesizes comprehensive answers
- Provides citations with exact text locations
- Adapts complexity to your expertise level

## Tech Stack

- **Node.js** with **Express** - Web server
- **TypeScript** - Type-safe development
- **OpenAI API** - LLM for agent reasoning
- **LangGraph** - Agent orchestration
- **Redis** - Session and state storage
- **GROBID** - Citation extraction from PDFs

## Key API Endpoints

### `POST /api/query`
Submit a question about a research paper.
```bash
curl -X POST http://localhost:3001/api/query \
  -F "file=@paper.pdf" \
  -F "query=What is the main contribution?"
```

### `POST /api/feedback`
Provide feedback to improve answers.

### `GET /api/health`
Check if the backend is running.

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment** (create `.env` file):
   ```env
   OPENAI_API_KEY=your_key_here
   PORT=3001
   GROBID_URL=http://localhost:8070
   ```

3. **Run the server**:
   ```bash
   npm run dev
   ```

## How It Works

1. You upload a PDF and ask a question
2. **A0** analyzes your question and extracts keywords
3. **A1** extracts citations, searches arXiv, and builds evidence
4. **A2** synthesizes an answer with detailed citations
5. You get an answer with highlighted sections and exact locations

## Dependencies

This backend requires:
- **Redis**: For session storage (see operations guide)
- **GROBID**: For citation extraction (see operations guide)
- **OpenAI API Key**: For AI agent reasoning

For detailed setup of dependencies, see the main `OPERATIONS_GUIDE.md`.
