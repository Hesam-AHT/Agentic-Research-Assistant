// --- DOM Elements ---
const body = document.body;
const welcomePage = document.getElementById('welcome-page');
const answerPage = document.getElementById('answer-page');
const uploadModal = document.getElementById('upload-modal');
const pdfViewerContent = document.getElementById('pdf-viewer-content');
const loadingIndicator = document.getElementById('loading-indicator'); 

const welcomeInput = document.getElementById('welcome-input');
const showUploadModalBtn = document.getElementById('show-upload-modal-btn');
const exampleButtons = document.querySelectorAll('.example-btn');

const hideUploadModalBtn = document.getElementById('hide-upload-modal-btn');
const dropzone = document.getElementById('upload-dropzone');
const fileInput = document.getElementById('pdf-file-input');
const modalContinueBtn = document.getElementById('modal-continue-btn');

const pdfFilenameSpan = document.getElementById('pdf-filename');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const pageInfo = document.getElementById('page-info');

let initialQuestion = '';
let uploadedFile = null;
let pdfDoc = null;
let currentPageNum = 1;
let pageElements = [];
let sessionId = null;

// --- UI Functions ---
function switchView(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    if (view === 'welcome') welcomePage.classList.remove('hidden');
    else if (view === 'reader') answerPage.classList.remove('hidden');
    body.setAttribute('data-view', view);
}

function toggleUploadModal(show) {
    if (show) {
        uploadModal.classList.remove('hidden');
        uploadedFile = null;
        fileInput.value = '';
        dropzone.style.borderColor = 'var(--color-border-light)';
        dropzone.querySelector('p').textContent = 'Click to upload or drag and drop';
        dropzone.querySelector('.small-text').textContent = 'PDF files only';
        dropzone.querySelector('.upload-icon').textContent = '↑';
        modalContinueBtn.classList.add('disabled');
        modalContinueBtn.disabled = true;
    } else uploadModal.classList.add('hidden');
}

function handleFileSelect(file) {
    if (file && file.name.endsWith('.pdf')) {
        uploadedFile = file;
        dropzone.style.borderColor = 'green';
        dropzone.querySelector('p').textContent = `File Ready: ${file.name}`;
        dropzone.querySelector('.small-text').textContent = `Size: ${(file.size/1024/1024).toFixed(2)} MB`;
        dropzone.querySelector('.upload-icon').textContent = '✓';
        modalContinueBtn.classList.remove('disabled');
        modalContinueBtn.disabled = false;
    } else alert('Please select a valid PDF file.');
}

// --- Chat ---
function appendMessage(text, sender="ai") {
    const msgDiv = document.createElement('div');
    msgDiv.className = sender==="user" ? 'ai-message user-message' : 'ai-message';
    msgDiv.innerHTML = `<div class="message-text">${text}</div>`;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendChatMessage() {
    const messageText = chatInput.value.trim();
    
    if (messageText === '') return;

    appendMessage(messageText, "user");
    chatInput.value = '';

    // Remove the separate 'loading data' visual by not showing loadingIndicator here

    // Send query with file if available
    const formData = new FormData();
    if (uploadedFile) {
        formData.append('file', uploadedFile);
    }
    formData.append('query', messageText);
    if (sessionId) {
        formData.append('sessionId', sessionId);
    }

    fetch("/api/query", {
        method:"POST",
        body: formData
    })
    .then(res => {
        if (!res.ok) {
            return res.json().then(err => Promise.reject(new Error(err.error || 'Server error')));
        }
        return res.json();
    })
    .then(data => {
        // Store session ID if provided
        if (data.sessionId) {
            sessionId = data.sessionId;
        }
        
        // Display answer
        if (data.answer) {
            appendMessage(marked.parse(data.answer), "ai");
        }
        
        // Display citations
        if (data.citations && data.citations.length > 0) {
            let citationsText = "\n\n**Citations:**\n";
            data.citations.forEach((cite: any, idx: number) => {
                citationsText += `${idx + 1}. ${cite.formatted || cite.title || cite}\n`;
            });
            appendMessage(marked.parse(citationsText), "ai");
        }
    })
    .catch(err => {
        appendMessage(`<span style="color:red;">Failed to query backend: ${err.message}</span>`, "ai");
    });
}

// --- Send PDF to backend ---
function sendPdfToBackend(file) {
    // Check and append initial question first
    const questionToSend = initialQuestion.trim();
    if (questionToSend) {
        appendMessage(questionToSend, "user");
    }
    initialQuestion = ''; // Clear initial question after first use

    // Append the "Sending PDF" message
    appendMessage("Sending PDF to backend for full text processing...", "ai");

    // Use FormData to send file (multipart/form-data)
    const formData = new FormData();
    formData.append('file', file);
    formData.append('query', questionToSend || 'What is this paper about?');

    fetch("/api/query", {
        method:"POST",
        body: formData
    })
    .then(res => {
        if (!res.ok) {
            return res.json().then(err => Promise.reject(new Error(err.error || 'Server error')));
        }
        return res.json();
    })
    .then(data => {
        // Store session ID if provided
        if (data.sessionId) {
            sessionId = data.sessionId;
        }
        
        // PDF uploaded and processed successfully
        appendMessage(`PDF **${file.name}** processed successfully.`, "ai");
        
        // Display the answer if available
        if (data.answer) {
            appendMessage(marked.parse(data.answer), "ai");
        }
        
        // Display citations if available
        if (data.citations && data.citations.length > 0) {
            let citationsText = "\n\n**Citations:**\n";
            data.citations.forEach((cite, idx) => {
                citationsText += `${idx + 1}. ${cite.formatted || cite.title || cite}\n`;
            });
            appendMessage(marked.parse(citationsText), "ai");
        }
    })
    .catch(err => {
        appendMessage(`<span style="color:red;">Failed to send PDF: ${err.message}</span>`, "ai");
    });
    };
    reader.readAsDataURL(file);
}

// --- PDF.js Integration ---
function getFitScale(page){ return pdfViewerContent.clientWidth / page.getViewport({scale:1}).width; }

async function renderSinglePageSVG(page, scale){
    const opList = await page.getOperatorList();
    const svgGfx = new pdfjsLib.SVGGraphics(page.commonObjs,page.objs);
    const svg = await svgGfx.getSVG(opList, page.getViewport({scale}));
    const wrapper = document.createElement('div');
    wrapper.className='pdf-page-wrapper';
    wrapper.setAttribute('data-page-num', page.pageNumber);
    wrapper.style.width=Math.floor(page.getViewport({scale}).width)+'px';
    wrapper.style.height=Math.floor(page.getViewport({scale}).height)+'px';
    wrapper.appendChild(svg);
    return wrapper;
}

async function renderAllPages(){
    if(!pdfDoc) return;
    pdfViewerContent.innerHTML=''; pageElements=[];
    pageInfo.textContent=`1 of ${pdfDoc.numPages}`; currentPageNum=1;
    const firstPage = await pdfDoc.getPage(1);
    const fitScale = getFitScale(firstPage);
    for(let i=1;i<=pdfDoc.numPages;i++){
        const page = await pdfDoc.getPage(i);
        const pageEl = await renderSinglePageSVG(page, fitScale);
        pdfViewerContent.appendChild(pageEl);
        pageElements.push(pageEl);
    }
}

function trackCurrentPage(){
    const scrollCenter=pdfViewerContent.scrollTop+pdfViewerContent.offsetHeight/2;
    let newPageNum=1;
    for(const pageEl of pageElements){
        if(pageEl.offsetTop<=scrollCenter) newPageNum=parseInt(pageEl.getAttribute('data-page-num'));
        else break;
    }
    if(newPageNum!==currentPageNum){currentPageNum=newPageNum; pageInfo.textContent=`${currentPageNum} of ${pdfDoc.numPages}`;}
}

function loadAndRenderPdf(file){
    pdfFilenameSpan.textContent=file.name;
    pdfViewerContent.innerHTML='<p class="pdf-mock-intro">Loading PDF...</p>';
    pdfViewerContent.removeEventListener('scroll', trackCurrentPage);

    const reader=new FileReader();
    reader.onload=function(e){
        const loadingTask=pdfjsLib.getDocument({data:new Uint8Array(e.target.result)});
        loadingTask.promise.then(pdf=>{
            pdfDoc=pdf;
            renderAllPages().then(()=>pdfViewerContent.addEventListener('scroll', trackCurrentPage));
        }).catch(err=>{
            pdfViewerContent.innerHTML=`<p style="color:red;">Error loading PDF: ${err.message}</p>`;
        });
    };
    reader.readAsArrayBuffer(file);
}

// --- Event Listeners ---
exampleButtons.forEach(btn=>btn.addEventListener('click',e=>{
    initialQuestion=e.target.getAttribute('data-question'); welcomeInput.value=initialQuestion;
}));

showUploadModalBtn.addEventListener('click',()=>{ initialQuestion=welcomeInput.value.trim(); toggleUploadModal(true); });
hideUploadModalBtn.addEventListener('click',()=>toggleUploadModal(false));

dropzone.addEventListener('click',()=>fileInput.click());
fileInput.addEventListener('change',e=>handleFileSelect(e.target.files[0]));
dropzone.addEventListener('dragover',e=>{e.preventDefault(); dropzone.style.borderColor='#999';});
dropzone.addEventListener('dragleave',e=>{e.preventDefault(); dropzone.style.borderColor='var(--color-border-light)';});
dropzone.addEventListener('drop',e=>{ e.preventDefault(); dropzone.style.borderColor='var(--color-border-light)'; handleFileSelect(e.dataTransfer.files[0]); });

modalContinueBtn.addEventListener('click',()=>{
    if(uploadedFile){
        toggleUploadModal(false);
        switchView('reader');
        loadAndRenderPdf(uploadedFile);
        sendPdfToBackend(uploadedFile);
    }
});

sendChatBtn.addEventListener('click',sendChatMessage);
chatInput.addEventListener('keypress',e=>{ if(e.key==='Enter') sendChatMessage(); });

// --- Initialize ---
switchView('welcome');