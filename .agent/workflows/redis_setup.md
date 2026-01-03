---
description: How to run and check Redis status
---

# Redis Setup & Management

## 1. Check if Redis is Running
Use the `ping` command. If Redis is running, it will reply with `PONG`.
```bash
redis-cli ping
```

Or check the process list:
```bash
ps aux | grep redis
```

## 2. Start Redis Server
If it is not running, start it in the background:
```bash
redis-server --daemonize yes
```

Or run it in a separate terminal tab (foreground):
```bash
redis-server
```

## 3. Installation (if missing)
If `redis-server` is command not found:
```bash
sudo apt update
sudo apt install redis-server
```

## 4. Configuration
The default port is `6379`.
The connection URL is usually `redis://localhost:6379`.
