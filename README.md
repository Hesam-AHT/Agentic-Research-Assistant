# RefHunters

Welcome to **RefHunters**, an advanced multi-agent system designed to simplify scientific research. It automatically extracts citations, retrieves relevant papers from arXiv, and provides intelligent Q&A grounded in verified evidence.

## 📁 Project Structure

The repository is divided into two main components:

### 1. [Backend (RefHunters-Backend)](./Second-backend/README.md)
The core "brain" of the system.
- **Agents**: A0 (Controller), A1 (Evidence Collector), A2 (Reasoning Agent).
- **Core APIs**: Node.js, LangGraph, OpenAI.
- **Services**: GROBID (PDF parsing), Redis (Memory).

### 2. [Frontend (RefHunters-Frontend)](./Second-Frontend/README.md)
The user interface.
- **UI**: React + Vite + Tailwind CSS.
- **Workspace**: Interactive dual-pane PDF viewer and AI answer panel.

---

## 🚀 Quick Start (Overall)

1. **Backend Setup**:
   ```bash
   cd Second-backend
   npm install
   cp .env.example .env  # Add your OpenAI Key
   npm run dev
   ```

2. **Frontend Setup**:
   ```bash
   cd Second-Frontend
   npm install
   npm run dev
   ```

Check the [OPERATIONS_GUIDE.md](./OPERATIONS_GUIDE.md) for detailed commands on starting external services like **GROBID** and **Redis**.

---

## 📜 Documentation Links
- [Backend Documentation](./Second-backend/README.md)
- [Frontend Documentation](./Second-Frontend/README.md)
- [Operations & Service Guide](./OPERATIONS_GUIDE.md)