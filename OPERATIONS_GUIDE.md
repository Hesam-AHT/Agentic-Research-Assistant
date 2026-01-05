# Operations Guide

Complete guide for running, stopping, and checking all RefHunters services.
---

## 🔄 Complete System Start/Stop

### Start All Services

```bash
# 1. Start Redis (background)
redis-server --daemonize yes

# 2. Start GROBID (background)
docker run -d --name grobid -p 8070:8070 grobid/grobid:0.8.0

# 3. Start Backend (new terminal)
cd Second-backend && npm run dev

# 4. Start Frontend (new terminal)
cd Second-Frontend && npm run dev
```

### Stop All Services

```bash
# 1. Stop Backend
# Press Ctrl + C in backend terminal

# 2. Stop Frontend
# Press Ctrl + C in frontend terminal

# 3. Stop GROBID
docker stop grobid && docker rm grobid

# 4. Stop Redis
redis-cli shutdown
```

### Check All Services

```bash
echo "=== Backend ==="
curl -s http://localhost:3001/api/health

echo -e "\n=== Frontend ==="
curl -s http://localhost:5173 > /dev/null && echo "Frontend is running" || echo "Frontend is not running"

echo -e "\n=== Redis ==="
redis-cli ping

echo -e "\n=== GROBID ==="
curl -s http://localhost:8070/api/isalive
```
