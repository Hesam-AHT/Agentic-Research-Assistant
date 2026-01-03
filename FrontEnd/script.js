const BACKEND_URL = "http://localhost:8000"; // Pointing to link.py (Proxy)

// --- DOM Elements ---
const body = document.body;
const welcomePage = document.getElementById('welcome-page');
const answerPage = document.getElementById('answer-page');
const uploadModal = document.getElementById('upload-modal');
const pdfViewerContent = document.getElementById('pdf-viewer-content');
const pdfFilenameSpan = document.getElementById('pdf-filename');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const pageInfo = document.getElementById('page-info');
const welcomeInput = document.getElementById('welcome-input');
const showUploadModalBtn = document.getElementById('show-upload-modal-btn');
const exampleButtons = document.querySelectorAll('.example-btn');
const hideUploadModalBtn = document.getElementById('hide-upload-modal-btn');
const dropzone = document.getElementById('upload-dropzone');
const fileInput = document.getElementById('pdf-file-input');
const modalContinueBtn = document.getElementById('modal-continue-btn');
const startChatBtn = document.getElementById('start-chat-btn');

// --- State Variables ---
let uploadedFile = null;
let pdfDoc = null;
let currentPageNum = 1;
let pageElements = [];
let sessionId = null; 

// --- UI Logic ---
function switchView(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    if (view === 'welcome') welcomePage.classList.remove('hidden');
    else if (view === 'reader') answerPage.classList.remove('hidden');
    body.setAttribute('data-view', view);
}

function toggleUploadModal(show) {
    if (show) {
        uploadModal.classList.remove('hidden');
    } else {
        uploadModal.classList.add('hidden');
    }
}

function handleFileSelect(file) {
    if (file && file.name.endsWith('.pdf')) {
        uploadedFile = file;
        dropzone.style.borderColor = 'green';
        dropzone.querySelector('p').textContent = `File Ready: ${file.name}`;
        modalContinueBtn.classList.remove('disabled');
        modalContinueBtn.disabled = false;
    }
}

// --- Chat & Network Logic ---
function appendMessage(text, sender = "ai") {
    const msgDiv = document.createElement('div');
    msgDiv.className = sender === "user" ? 'ai-message user-message' : 'ai-message';
    const content = sender === "ai" ? marked.parse(text) : text;
    msgDiv.innerHTML = `<div class="message-text">${content}</div>`;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendChatMessage(messageText = null) {
    const text = messageText || chatInput.value.trim();
    if (!text) return;

    appendMessage(text, "user");
    chatInput.value = '';
    
    const thinkingDiv = document.createElement('div');
    thinkingDiv.className = 'ai-message';
    thinkingDiv.innerHTML = `<div class="message-text"><i>Thinking...</i></div>`;
    chatMessages.appendChild(thinkingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    const formData = new FormData();
    formData.append("query", text);
    
    if (sessionId) {
        formData.append("sessionId", sessionId);
    } else if (uploadedFile) {
        formData.append("file", uploadedFile);
    }

    try {
        const res = await fetch(`${BACKEND_URL}/api/query`, {
            method: "POST",
            body: formData
        });
        const data = await res.json();
        thinkingDiv.remove();

        if (data.sessionId) sessionId = data.sessionId;
        appendMessage(data.answer || "No response received.", "ai");

    } catch (err) {
        thinkingDiv.innerHTML = `<div class="message-text" style="color:red;">Connection Error.</div>`;
    }
}

// --- PDF Rendering ---
function getFitScale(page) { return pdfViewerContent.clientWidth / page.getViewport({scale: 1}).width; }

async function renderAllPages() {
    if (!pdfDoc) return;
    pdfViewerContent.innerHTML = '';
    pageElements = [];
    const firstPage = await pdfDoc.getPage(1);
    const fitScale = getFitScale(firstPage);

    for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const viewport = page.getViewport({scale: fitScale});
        const opList = await page.getOperatorList();
        const svgGfx = new pdfjsLib.SVGGraphics(page.commonObjs, page.objs);
        const svg = await svgGfx.getSVG(opList, viewport);
        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page-wrapper';
        wrapper.appendChild(svg);
        pdfViewerContent.appendChild(wrapper);
        pageElements.push(wrapper);
    }
}

function loadAndRenderPdf(file) {
    pdfFilenameSpan.textContent = file.name;
    const reader = new FileReader();
    reader.onload = function(e) {
        const loadingTask = pdfjsLib.getDocument({data: new Uint8Array(e.target.result)});
        loadingTask.promise.then(pdf => {
            pdfDoc = pdf;
            renderAllPages();
        });
    };
    reader.readAsArrayBuffer(file);
}

// --- Event Listeners with PREVENT DEFAULT ---
modalContinueBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (uploadedFile) {
        toggleUploadModal(false);
        switchView('reader');
        loadAndRenderPdf(uploadedFile);
        sendChatMessage(welcomeInput.value.trim());
    }
});

startChatBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!uploadedFile) toggleUploadModal(true);
    else {
        switchView('reader');
        loadAndRenderPdf(uploadedFile); // Added to ensure PDF shows up
        sendChatMessage(welcomeInput.value.trim());
    }
});

sendChatBtn.addEventListener('click', (e) => {
    e.preventDefault();
    sendChatMessage();
});

// FIXED: Added Enter key listener for the Welcome Input to stop refresh
welcomeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        startChatBtn.click();
    }
});

chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        sendChatMessage();
    }
});

showUploadModalBtn.addEventListener('click', (e) => { e.preventDefault(); toggleUploadModal(true); });
hideUploadModalBtn.addEventListener('click', (e) => { e.preventDefault(); toggleUploadModal(false); });
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => handleFileSelect(e.target.files[0]));

exampleButtons.forEach(btn => btn.addEventListener('click', (e) => {
    e.preventDefault();
    welcomeInput.value = btn.getAttribute('data-question');
}));

switchView('welcome'); 


