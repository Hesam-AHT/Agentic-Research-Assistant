# RefHunters

**RefHunters** is an AI-powered research assistant that helps you understand scientific papers. Upload a PDF, ask questions, and get intelligent answers with precise citations.

## What Is RefHunters?

RefHunters uses **3 specialized AI agents** to:
1. **Extract citations** from your uploaded paper
2. **Search and download** related papers from arXiv
3. **Answer your questions** with evidence from multiple sources
4. **Highlight exact locations** in the paper where information comes from

Think of it as having a research assistant that reads papers for you and answers questions with specific citations.

## Key Features

- 📄 **PDF Upload**: Upload papers or provide a DOI
- 🤖 **Multi-Agent AI**: 3 specialized agents work together to answer questions
- 🔍 **Smart Citations**: See exact paragraph, line, and sentence where information comes from
- 📚 **Related Papers**: Automatically finds and cites relevant arXiv papers
- 💬 **Interactive Q&A**: Ask follow-up questions and provide feedback
- ✨ **Beautiful UI**: Dual-pane workspace with PDF viewer and AI answers side-by-side

## System Architecture

```
┌─────────────┐         ┌─────────────┐
│             │         │             │
│  Frontend   │ ◄─────► │   Backend   │
│  (React)    │         │  (3 Agents) │
│             │         │             │
└─────────────┘         └──────┬──────┘
                               │
                    ┌──────────┼──────────┐
                    │          │          │
               ┌────▼───┐  ┌───▼────┐ ┌──▼────┐
               │ Redis  │  │ GROBID │ │ OpenAI│
               │(Memory)│  │  (PDF) │ │ (LLM) │
               └────────┘  └────────┘ └───────┘
```

### Components

1. **[Frontend](./Second-Frontend/README.md)** - React + Vite interface
   - Dual-pane PDF viewer and Q&A workspace
   - Citation highlighting and navigation
   
2. **[Backend](./Second-backend/README.md)** - Node.js + TypeScript
   - 3 AI agents: Coordinator, Evidence Collector, Answer Generator
   - API for query processing and feedback

3. **External Services**
   - **Redis**: Session and state storage
   - **GROBID**: PDF citation extraction
   - **OpenAI**: LLM for agent reasoning

## Quick Start

### Prerequisites

- Node.js (v16+)
- Redis server
- GROBID service (Docker)
- OpenAI API key

### 1. Setup Backend

```bash
cd Second-backend
npm install
cp .env.example .env  # Add your OPENAI_API_KEY
npm run dev
```

Backend will run on `http://localhost:3001`

### 2. Setup Frontend

```bash
cd Second-Frontend
npm install
npm run dev
```

Frontend will run on `http://localhost:5173` or `http://localhost:5174`

### 3. Start External Services

See **[OPERATIONS_GUIDE.md](./OPERATIONS_GUIDE.md)** for detailed commands to start:
- Redis
- GROBID

## How to Use

1. **Open the frontend** in your browser
2. **Upload a PDF** or provide a DOI
3. **Ask a question** about the paper
4. **View the answer** with highlighted citations in the PDF
5. **Click citations** to jump to exact locations
6. **Provide feedback** to improve future answers

## Documentation

- **[Backend README](./Second-backend/README.md)** - Agent architecture and API
- **[Frontend README](./Second-Frontend/README.md)** - UI features and tech stack
- **[Operations Guide](./OPERATIONS_GUIDE.md)** - How to start, stop, and check all services

## Environment Variables

### Backend (.env)
```env
OPENAI_API_KEY=your_key_here
PORT=3001
GROBID_URL=http://localhost:8070
```

### Frontend (.env)
```env
VITE_API_URL=http://localhost:3001
```

## Tech Stack

**Frontend:**
- React, TypeScript, Vite, Tailwind CSS, PDF.js

**Backend:**
- Node.js, Express, TypeScript, LangGraph, OpenAI

**Services:**
- Redis, GROBID, arXiv API

## Project Structure

```
.
├── Second-backend/          # Backend (3 AI agents)
│   ├── src/
│   │   ├── agents/         # A0, A1, A2 agent logic
│   │   ├── routes/         # API endpoints
│   │   └── server.ts       # Express server
│   └── README.md
│
├── Second-Frontend/         # Frontend (React UI)
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── services/       # API client
│   │   └── store/          # State management
│   └── README.md
│
├── README.md               # This file
└── OPERATIONS_GUIDE.md     # Service management guide
```

## Need Help?

- **Can't start a service?** Check `OPERATIONS_GUIDE.md`
- **Backend not responding?** Run `curl http://localhost:3001/api/health`
- **Frontend can't connect?** Verify `VITE_API_URL` in `.env`
- **GROBID errors?** Ensure Docker container is running on port 8070
- **Redis errors?** Run `redis-cli ping` to check status

## License

MIT