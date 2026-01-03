# Operations Guide: Start, Stop, and Health Checks

This guide provides commands to manage the various services of the RefHunters.

## 🚀 1. Backend Service
The backend handles the multi-agent logic (A0, A1, A2) and exposes the API.

- **Start**:
  ```bash
  cd Second-backend
  npm run dev
  # OR directly:
  npx tsx src/server.ts
  ```
- **Stop**: `Ctrl + C` in the running terminal.
- **Check Status**:
  ```bash
  curl http://localhost:3001/api/health
  ```
  *Expected Response*: `{"status":"ok", ...}`

---

## 🖥️ 2. Frontend Service
The React + Vite frontend for the user interface.

- **Start**:
  ```bash
  cd Second-Frontend
  npm run dev
  ```
- **Stop**: `Ctrl + C` in the running terminal.
- **Check Status**:
  - Open `http://localhost:5174` in your browser.
  - Or check if the process is listening: `lsof -i :5174`

---

## 📜 3. Grobid (PDF Parsing)
Grobid is used for extracting structured citations from scientific papers.

- **Start (via Docker推荐)**:
  ```bash
  docker run --rm --init -p 8070:8070 grobid/grobid:0.8.0
  ```
- **Stop**: `docker stop <container_id>` or `Ctrl + C` if running in foreground.
- **Check Status**:
  ```bash
  curl http://localhost:8070/api/isalive
  ```
  *Expected Response*: `true` (plain text)

---

## 💾 4. Redis (Memory Storage)
Redis stores the agent states and session memory.

- **Start**:
  ```bash
  redis-server --daemonize yes
  ```
- **Stop**:
  ```bash
  redis-cli shutdown
  ```
- **Check Status**:
  ```bash
  redis-cli ping
  ```
  *Expected Response*: `PONG`

---

## 🛠️ 5. Troubleshooting Ports
If a port is already in use, you can find the process and kill it:

```bash
# Find process on port 3001
lsof -i :3001

# Kill process
kill -9 <PID>
```
