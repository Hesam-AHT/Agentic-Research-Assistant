# RefHunters Frontend

React + Vite + TypeScript frontend for the RefHunters research assistant.

---

## 🏗️ Architecture Overview

The frontend is a dual-pane React application featuring a chat interface and a PDF viewer.

### Key Routes
- `/` → **UploadPage**: PDF upload and expertise selection.
- `/answer` → **AnswerPage**: Interactive Q&A with live PDF highlighting.
- `/test-highlight` → **PDFHighlightTest**: Debugging tool for PDF section search.

---

## 📁 File Structure

```
src/
├── components/
│   ├── upload/     # UploadPage.tsx
│   ├── answer/     # AnswerPage.tsx (Main chat logic)
│   ├── shared/     # PDFViewer.tsx (pdf.js integration)
│   └── test/       # PDFHighlightTest.tsx
├── services/       # api.ts (Backend communication)
├── types/          # API and PDF type definitions
└── App.tsx         # Router configuration
```

---

## 🔄 User Flow

1.  **Upload**: User selects a PDF and their expertise level.
2.  **Query**: On the first question, the PDF is uploaded and a session is started.
3.  **Chat**: Users ask questions; backend returns answers with citations.
4.  **Interaction**: Clicking a citation `[1]` triggers the PDF viewer to search and highlight the relevant section.

---

## 🚀 Quick Start

### Setup
```bash
# Install dependencies
npm install

# Setup environment (.env)
VITE_API_URL=http://localhost:3001
```

### Development
```bash
# Run dev server
npm run dev
# Opens at http://localhost:5173
```

---

## 📦 Core Technologies

- **UI Framework**: React
- **Routing**: React Router
- **PDF Engine**: pdf.js (via react-pdf)
- **Styling**: Tailwind CSS
- **API Client**: Axios

---

## 📊 State Management

- **Session Context**: Managed via `AnswerPage` state (sessionId, message history).
- **Navigation State**: PDF file and expertise levels are passed from `UploadPage` to `AnswerPage` via router state.
- **Highlighting**: Triggered by setting a `searchText` prop on the `PDFViewer`.

---

## 🔧 Feature Status

- ✅ PDF Upload & Processing
- ✅ Interactive Chat Interface
- ✅ Multi-page PDF Rendering
- ✅ Citation-to-PDF Highlighting
- ⏳ Multi-PDF Analysis (Planned)

---

**Maintained by:** RefHunters Team  
**Last Updated:** January 4, 2026
