# RefHunters - Backend

A multi-agent system for answering questions about research papers. The system uses three specialized agents to process user queries, extract information from papers, and generate comprehensive answers with detailed citations.

## System Architecture

### Agent 0 (A0) - Coordinator Agent
- **Role**: Main coordinator that communicates with users and other agents
- **Responsibilities**:
  - Receives user queries and extracts keywords
  - Classifies query type and expertise level
  - Decomposes complex queries into sub-questions
  - Plans and dispatches tasks to A1 and A2
  - Processes user feedback and routes to appropriate agents

### Agent 1 (A1) - Data & Evidence Agent
- **Role**: Extracts citations and builds knowledge base
- **Responsibilities**:
  - Extracts citations from uploaded PDFs using GROBID
  - Extracts text from main paper with paragraph/line tracking
  - Searches arXiv for related papers
  - Downloads PDFs or fetches abstracts
  - Builds evidence collection with location tracking
  - Tracks text locations (paragraph, line, sentence) in main paper

### Agent 2 (A2) - Reasoning Agent
- **Role**: Synthesizes answers from evidence
- **Responsibilities**:
  - Analyzes evidence from A1
  - Synthesizes comprehensive answers
  - Formats citations with location details
  - Adapts answer complexity to user expertise level

## Features

### 1. Paper Upload
- **Single PDF Upload**: Users can upload one PDF file
- **DOI Support**: Users can provide a DOI, and the system will download the PDF
- **Text Extraction**: Extracts full text with paragraph and line number tracking

### 2. Query Processing
- **Keyword Extraction**: Automatically extracts key terms from user queries
- **Query Classification**: Determines query type (QA, summarization, comparison, extraction)
- **Expertise Adaptation**: Adjusts answer complexity (novice, intermediate, expert)

### 3. Answer Generation
- **Main Paper Highlighting**: Highlights relevant sections from the uploaded paper
- **Location Details**: Provides exact locations (paragraph, line, starting sentence) for cited text
- **Related Citations**: Includes citations from related papers found via arXiv

### 4. Feedback Loop
- **User Feedback**: Users can provide feedback on answers
- **Smart Routing**: Based on feedback, system routes to:
  - **A1**: If wrong citations or need more information (rebuilds knowledge base)
  - **A2**: If answer quality issues (regenerate answer with existing evidence)

## API Endpoints

### POST `/api/query`
Submit a query about a research paper.

**Request:**
- `query` (string, required): The user's question
- `file` (file, optional): PDF file upload (multipart/form-data)
- `doi` (string, optional): DOI of the paper (if no file uploaded)
- `sessionId` (string, optional): Session ID for continuing conversation

**Response:**
```json
{
  "sessionId": "session_123",
  "answer": "The answer text...",
  "citations": [
    {
      "index": 1,
      "formatted": "[1] Author et al. (2023). Title. Journal.",
      "is_main_paper": true,
      "locations": [
        {
          "paragraph": 2,
          "line": 3,
          "start_sentence": "The relevant sentence...",
          "details": "Paragraph 2, Line 3: \"The relevant sentence...\""
        }
      ]
    }
  ],
  "highlightedSections": [
    {
      "paragraph": 2,
      "line": 3,
      "start_sentence": "The relevant sentence...",
      "text": "The relevant sentence..."
    }
  ],
  "mainPaperPath": "/path/to/paper.pdf",
  "evidenceCount": 5
}
```

### POST `/api/feedback`
Provide feedback on an answer.

**Request:**
```json
{
  "sessionId": "session_123",
  "feedback": {
    "helpful": false,
    "wrong_citations": [{"doi": "10.1234/example"}],
    "verbosity": "shorter",
    "needs_more_info": true,
    "answer_wrong": false,
    "unclear": false
  },
  "lastQuery": "Original query",
  "lastAnswer": "Previous answer"
}
```

**Response:**
```json
{
  "sessionId": "session_123",
  "decision": "User needs more information, search for additional evidence",
  "nextAction": {
    "agent": "A1",
    "result": {...},
    "message": "New knowledge base created. Would you like a new answer?"
  }
}
```

### GET `/api/health`
Health check endpoint.

## Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

3. Set up environment variables (create `.env` file):
```env
OPENAI_API_KEY=your_openai_api_key_here
GROBID_URL=http://localhost:8070  # Optional, defaults to localhost:8070
PORT=3000  # Optional, defaults to 3000
```

4. (Optional) Set up GROBID for citation extraction:
   - Install and run GROBID server
   - Default URL: http://localhost:8070

5. Build the project:
```bash
npm run build
```

6. Start the server:
```bash
npm start
```

Or for development:
```bash
npm run dev
```

## Usage Example

### Upload PDF and Ask Question

```bash
curl -X POST http://localhost:3000/api/query \
  -F "file=@paper.pdf" \
  -F "query=What is the main contribution of this paper?"
```

### Use DOI Instead

```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{
    "doi": "10.1234/example.doi",
    "query": "What methods are used in this paper?"
  }'
```

### Provide Feedback

```bash
curl -X POST http://localhost:3000/api/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "session_123",
    "feedback": {
      "helpful": false,
      "needs_more_info": true
    },
    "lastQuery": "What is the main contribution?",
    "lastAnswer": "Previous answer..."
  }'
```

## Response Format Details

### Highlighted Sections
The system provides detailed location information for text from the main paper:
- **Paragraph Number**: Which paragraph contains the relevant text
- **Line Number**: Which line within that paragraph
- **Starting Sentence**: The sentence where the relevant text begins

### Citations
Citations include:
- Standard citation format (APA, IEEE, MLA)
- For main paper: Detailed location information
- For related papers: Standard metadata (title, authors, year, DOI)

## System Flow

1. **User Upload**: User uploads PDF or provides DOI
2. **A0 Processing**: 
   - Extracts keywords from query
   - Classifies query type
   - Decomposes into sub-questions
3. **A1 Processing**:
   - Extracts citations from PDF
   - Extracts text with location tracking
   - Searches for related papers
   - Builds knowledge base
4. **A2 Processing**:
   - Analyzes evidence
   - Synthesizes answer
   - Formats citations with location details
5. **Response**: Returns answer with highlighted sections and detailed citations
6. **Feedback Loop**: User provides feedback, system routes to A1 or A2 as needed

## Dependencies

- **Express**: Web server framework
- **Multer**: File upload handling
- **OpenAI**: LLM for agent reasoning
- **pdf-parse**: PDF text extraction
- **GROBID**: Citation extraction (optional, requires separate service)
- **LangGraph**: Agent orchestration
- **Axios**: HTTP requests

## Notes

- The system is designed to handle **one PDF at a time**
- Main paper text is tracked with paragraph and line numbers
- Related citations are fetched from arXiv
- Feedback system allows iterative improvement of answers
- Session memory stores conversation context and blacklisted citations
