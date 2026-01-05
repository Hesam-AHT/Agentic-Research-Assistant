# RefHunters - Frontend

The user interface for RefHunters - a beautiful, interactive workspace for researching scientific papers with AI assistance.

## What Does It Do?

The frontend provides:
- **Dual-Pane Workspace**: View your PDF on the left, AI answers on the right
- **Smart Highlighting**: Click citations to see exact text highlighted in the PDF
- **Interactive Q&A**: Ask questions and get answers grounded in evidence
- **Citation Management**: Browse all referenced papers in a dedicated sidebar

## Tech Stack

- **React 18** - Modern UI framework
- **Vite** - Fast development and build tool
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Beautiful, responsive styling
- **PDF.js** - PDF rendering and highlighting
- **Zustand** - Simple state management
- **React Markdown** - Rich answer formatting

## Features

### 🔍 Dual-Pane Research Workspace
- **Left**: PDF viewer with paragraph-level navigation
- **Right**: AI-generated answers with citations
- **Synchronized**: Click citations to jump to exact text in PDF

### 📝 Intelligent Q&A
- Ask any question about your uploaded paper
- Get answers synthesized from multiple sources
- See citations with exact locations (paragraph, line, sentence)

### 🎯 Expertise Levels
Toggle between modes to control answer complexity:
- **Novice**: Simple explanations
- **Intermediate**: Balanced detail
- **Expert**: Technical depth

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure backend URL** (create `.env` file):
   ```env
   VITE_API_URL=http://localhost:3001
   ```

3. **Start development server**:
   ```bash
   npm run dev
   ```

4. **Open in browser**:
   Usually at `http://localhost:5173` or `http://localhost:5174`

## Project Structure

```
src/
├── components/
│   ├── upload/      # File upload page
│   ├── answer/      # Main workspace with PDF + Q&A
│   └── shared/      # Reusable UI components
├── services/        # API communication
├── store/           # State management
├── hooks/           # Custom React hooks
└── types/           # TypeScript definitions
```

## How It Works

1. Upload a PDF or provide a DOI
2. Ask questions in the chat interface
3. View AI-generated answers with citations
4. Click citations to see highlighted text in the PDF
5. Provide feedback to improve answers

## Build for Production

```bash
npm run build
```

Output will be in the `dist/` directory.

## Dependencies

This frontend requires:
- **Backend**: RefHunters backend running on port 3001
- See the main `OPERATIONS_GUIDE.md` for starting the backend
