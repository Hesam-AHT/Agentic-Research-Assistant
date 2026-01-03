# RefHunters - Frontend

A premium React + Vite + TypeScript interface for the **RefHunters** multi-agent research assistant.

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start development server
npm run dev

# 3. Access the UI
# Usually at http://localhost:5173 or http://localhost:5174
```

## ✨ Core Features

### 🔍 Dual-Pane Research Workspace
The heart of RefHunters. View your paper on the left while the AI analyzes it on the right.
- **Synchronized Scrolling**: Click a citation in the answer to see the exact text highlighted in the PDF.
- **Smart Highlighting**: Paragraph, line, and sentence-level tracking from the main paper.

### 📝 Intelligent Q&A
- **Multi-Source Synthesis**: Answers are grounded in both your uploaded paper and external arXiv sources.
- **Expertise Adaptation**: Toggle between *Novice*, *Intermediate*, and *Expert* modes for tailored explanations.
- **Reference Management**: A dedicated sidebar showcasing all cited sources with full metadata.

---

## 📁 Repository Structure

```text
src/
├── components/
│   ├── upload/      # Initial landing & file upload
│   ├── answer/      # Main dual-pane research workspace
│   └── shared/      # UI primitives (Buttons, Loaders, etc.)
├── services/        # Axios API client & communication logic
├── store/           # Zustand state management for paper & sessions
├── hooks/           # Custom React hooks for PDF interactions
└── types/           # Shared TypeScript definitions
```

## 🔌 Backend Integration

The frontend communicates with the **RefHunters Backend** (Node.js).

- **Default Port**: `3001`
- **Configuration**: Set `VITE_API_URL` in your `.env` file.

```bash
# Example .env
VITE_API_URL=http://localhost:3001
```

### Key API Endpoints Used:
- `POST /upload`: PDF ingestion and session initialization.
- `POST /query`: Dispatches the multi-agent reasoning flow.
- `POST /feedback`: Captures user corrections to improve future responses.

## 🛠️ Tech Stack

- **Framework**: React 18
- **Build Tool**: Vite (Lightning fast HMR)
- **Styling**: Tailwind CSS
- **PDF Engine**: PDF.js (via react-pdf)
- **State**: Zustand (Simple, scalable state)
- **Markdown**: React-Markdown with syntax highlighting

---

## 🏗️ Production Build

To build the application for hosting:

```bash
npm run build
```

The output will be in the `dist/` directory.
