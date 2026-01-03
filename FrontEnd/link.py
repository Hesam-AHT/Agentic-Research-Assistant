from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import requests
from typing import Optional
import uvicorn

app = FastAPI()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

NODE_BACKEND_URL = "http://localhost:3000/api/query"


@app.post("/api/query")
async def forward_query(
    query: str = Form(...),
    file: Optional[UploadFile] = File(None),
    sessionId: Optional[str] = Form(None)
):
    payload = {"query": query}
    if sessionId:
        payload["sessionId"] = sessionId

    files = None
    if file:
        content = await file.read()
        files = {
            "file": (file.filename, content, file.content_type)
        }

    try:
        
        r = requests.post(
            NODE_BACKEND_URL,
            data=payload,
            files=files,
            allow_redirects=False,
            timeout=60
        )

      
        content_type = r.headers.get("content-type", "")
        if "application/json" not in content_type:
            return JSONResponse(
                status_code=502,
                content={
                    "error": "Upstream returned non-JSON response",
                    "status_code": r.status_code,
                    "content_type": content_type,
                    "preview": r.text[:500]
                }
            )

        return JSONResponse(content=r.json())

    except requests.RequestException as e:
        return JSONResponse(
            status_code=502,
            content={
                "error": "Node backend unreachable",
                "details": str(e)
            }
        )


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000
    )
