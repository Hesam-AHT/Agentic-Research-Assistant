import os
import json
import re
import requests
from dotenv import load_dotenv
from grobid_client.grobid_client import GrobidClient

# LangChain
from langchain.chat_models import ChatOpenAI
from langchain.schema import HumanMessage

load_dotenv()

OPENAI_KEY = os.getenv("OPENAI_API_KEY")

# LLM via LangChain
llm = ChatOpenAI(
    api_key=OPENAI_KEY,
    model="gpt-4o",
    temperature=0
)


# ---------------------------------------------------
# 1) Extract citations using GROBID
# ---------------------------------------------------
def extract_references_grobid(pdf_path: str):
    client_g = GrobidClient(config_path="grobid_config.json")

    client_g.process(
        "processFulltextDocument",
        pdf_path,
        output="grobid-output",
        consolidate_citations=True
    )

    tei_file = os.path.join("grobid-output", os.listdir("grobid-output")[0])

    with open(tei_file, "r", encoding="utf8") as f:
        xml_text = f.read()

    bibs = re.findall(r"<biblStruct(.+?)</biblStruct>", xml_text, re.DOTALL)
    return bibs


# ---------------------------------------------------
# 2) Convert XML citations → JSON via LLM
# ---------------------------------------------------
def citations_to_json(citation_blocks):
    blob = "\n\n".join(citation_blocks)

    msg = f"""
Parse the following GROBID <biblStruct> XML citations.
Return ONLY valid JSON array with:

[
  {{
    "title": "",
    "authors": [],
    "year": "",
    "journal": "",
    "doi": ""
  }}
]

CITATIONS:
{blob}
    """

    response = llm([HumanMessage(content=msg)])
    content = response.content

    try:
        return json.loads(content)
    except:
        print("\n[LLM BAD JSON OUTPUT]\n", content)
        return []


# ---------------------------------------------------
# 3) Search arXiv
# ---------------------------------------------------
def search_arxiv(title: str):
    url = f'https://export.arxiv.org/api/query?search_query=ti:"{title}"&max_results=1'
    xml = requests.get(url).text

    match = re.search(r"<id>https://arxiv\.org/abs/(.+?)</id>", xml)
    return match.group(1) if match else None


# ---------------------------------------------------
# 4) Download arXiv PDF
# ---------------------------------------------------
def download_pdf(arxiv_id: str, title: str) -> bool:
    pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
    r = requests.get(pdf_url)

    if r.status_code != 200:
        return False

    safe = re.sub(r"[^a-zA-Z0-9]", "_", title) or "untitled"
    os.makedirs("downloads", exist_ok=True)
    with open(f"downloads/{safe}.pdf", "wb") as f:
        f.write(r.content)

    return True


# ---------------------------------------------------
# 5) Fetch abstract if PDF isn't available
# ---------------------------------------------------
def fetch_arxiv_abstract(arxiv_id: str):
    url = f"https://export.arxiv.org/api/query?id_list={arxiv_id}"
    xml = requests.get(url).text

    match = re.search(r"<summary>(.*?)</summary>", xml, re.DOTALL)
    if not match:
        return None

    abstract = match.group(1).strip()
    abstract = re.sub(r"\s+", " ", abstract)
    return abstract


# ---------------------------------------------------
# 6) Agent1 — executes tasks from Agent0
# ---------------------------------------------------
def agent1(action, pdf_path=None, keyword=None):
    """
    action:
      - send_main_paper
      - build_kb_for_keyword
    """

    # --------------------------------
    # MODE 1 — فقط PDF اصلی لازم است
    # --------------------------------
    if action == "send_main_paper":
        return {
            "status": "ok",
            "message": "Main paper ready.",
            "pdf_path": pdf_path
        }

    # --------------------------------
    # MODE 2 — ساخت KB بر اساس keyword
    # --------------------------------
    elif action == "build_kb_for_keyword":

        if not pdf_path:
            return {"error": "pdf_path missing"}
        if not keyword:
            return {"error": "keyword missing"}

        print("\n[1] Extracting citations with GROBID…")
        xml_refs = extract_references_grobid(pdf_path)

        print("\n[2] Converting XML → JSON…")
        citations = citations_to_json(xml_refs)

        print("\n[3] Filtering citations by keyword…")
        filtered = [
            c for c in citations
            if keyword.lower() in (c.get("title", "").lower())
        ]

        knowledge_base = []

        print("\n[4] Building KB (PDF or Abstract)…")
        for ref in filtered:
            title = ref.get("title", "untitled")
            print(f" → {title}")

            arxiv_id = search_arxiv(title)
            if not arxiv_id:
                knowledge_base.append({
                    **ref,
                    "arxiv_id": None,
                    "downloaded": False,
                    "abstract_saved": False
                })
                continue

            # Try PDF
            if download_pdf(arxiv_id, title):
                knowledge_base.append({
                    **ref,
                    "arxiv_id": arxiv_id,
                    "downloaded": True,
                    "abstract_saved": False
                })
            else:
                # Fallback → Abstract
                abs_text = fetch_arxiv_abstract(arxiv_id)
                if abs_text:
                    safe = re.sub(r"[^a-zA-Z0-9]", "_", title)
                    os.makedirs("abstracts", exist_ok=True)
                    with open(f"abstracts/{safe}.txt", "w", encoding="utf8") as f:
                        f.write(abs_text)

                    knowledge_base.append({
                        **ref,
                        "arxiv_id": arxiv_id,
                        "downloaded": False,
                        "abstract_saved": True
                    })
                else:
                    knowledge_base.append({
                        **ref,
                        "arxiv_id": arxiv_id,
                        "downloaded": False,
                        "abstract_saved": False
                    })

        return {
            "status": "kb_built",
            "keyword": keyword,
            "count": len(knowledge_base),
            "knowledge_base": knowledge_base
        }

    else:
        return {"error": f"Unknown action: {action}"}


# ---------------------------------------------------
# Manual test (simulate Agent0)
# ---------------------------------------------------
if __name__ == "__main__":
    result = agent1(
        action="build_kb_for_keyword",
        pdf_path="paper.pdf",
        keyword="transformer"
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
