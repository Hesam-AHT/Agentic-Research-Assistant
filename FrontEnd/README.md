


# Agentic Research Assistant - Frontend

This repository contains the split-screen UI for PDF analysis and AI chat.

---

## Local Setup

### Start the Frontend Server
Do **NOT** use VS Code Live Server (it triggers unwanted reloads). Use Python instead:

```bash
python -m http.server 5500
````

Access the frontend at: [http://localhost:5500](http://localhost:5500)

---

### Backend Configuration

The frontend points to `http://localhost:8000`. Make sure your backend handles CORS:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)
```

---

### Troubleshooting for Backend Developers

If you see **502 Bad Gateway** in the logs:

* The frontend is successfully hitting your `/api/query` endpoint.
* The error is occurring internally in the backend logic (likely a connection issue with the LLM or an unhandled exception in the processing pipeline).

---

### API Contract

**Endpoint:** `POST /api/query`

**Format:** `multipart/form-data`

**Expected Return:**

```json
{
  "answer": "string",
  "sessionId": "string"
}
```

---

### Notes

* Ensure your backend is running on `http://localhost:8000` before accessing the frontend.


```

