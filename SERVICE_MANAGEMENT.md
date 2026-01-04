# Service Management

Quick commands to manage RefHunters services.

---

## GROBID

**Check:** `docker ps | grep grobid`  
**Start:** `docker start grobid`  
**Stop:** `docker stop grobid`

---

## Redis

**Check:** `systemctl is-active redis-server`  
**Start:** `sudo systemctl start redis-server`  
**Stop:** `sudo systemctl stop redis-server`

---

## Backend

**Check:** `lsof -i :3001`  
**Start:** `cd RefHunters-Backend && npx tsx src/server.ts`  
**Stop:** `Ctrl+C` or `pkill -f "tsx src/server.ts"`

---

## Frontend

**Check:** `lsof -i :5173`  
**Start:** `cd RefHunters-Frontend && npm run dev`  
**Stop:** `Ctrl+C` or `pkill -f "vite"`

---

## URLs

- Frontend: http://localhost:5173
- Backend: http://localhost:3001
- GROBID: http://localhost:8070
