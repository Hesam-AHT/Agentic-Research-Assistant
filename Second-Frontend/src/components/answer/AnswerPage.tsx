import { useState, useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../../services/api'
import type { ChatMessage } from '../../types/api'
import PDFViewer from '../shared/PDFViewer'
import ReactMarkdown from 'react-markdown'
import type { Highlight } from '../../types/pdf'

export default function AnswerPage() {
    const location = useLocation()
    const navigate = useNavigate()
    const { file, expertise: initialExpertise } = location.state || {}

    const [question, setQuestion] = useState('')
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [sessionId] = useState(() => `session-${Date.now()}`)
    const [expertise, setExpertise] = useState<'novice' | 'intermediate' | 'expert'>(initialExpertise || 'intermediate')
    const [uploadedPdfPath, setUploadedPdfPath] = useState<string | null>(null)
    const [highlights, setHighlights] = useState<Highlight[]>([])
    const [activeCitationIndex, setActiveCitationIndex] = useState<number | null>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)

    // Feedback system state
    const [feedbackRatings, setFeedbackRatings] = useState<Record<string, 'like' | 'dislike' | null>>({})
    const [showStyleOptions, setShowStyleOptions] = useState<string | null>(null)
    const [isRegenerating, setIsRegenerating] = useState(false)


    // Handle citation click for PDF highlighting - TEXT SEARCH BASED
    const handleCitationClick = async (citation: any) => {
        console.log('[Citation Click] Clicked citation:', citation)
        console.log('[Citation Click] is_main_paper:', citation.evidenceChunk?.is_main_paper)
        console.log('[Citation Click] section:', citation.evidenceChunk?.section)
        console.log('[Citation Click] text preview:', citation.evidenceChunk?.text?.substring(0, 100))

        // Only highlight if from main paper
        if (!citation.evidenceChunk?.is_main_paper) {
            console.log('[Citation Click]  Citation not from main paper - skipping highlight')
            return
        }

        const { section, text, locations } = citation.evidenceChunk
        console.log('[Citation Click]  Main paper citation - will search for text in PDF')
        setActiveCitationIndex(citation.index)

        // PRIORITY 1: Use precise locations if available
        if (locations && locations.length > 0) {
            const exactText = locations[0].start_sentence
            console.log(`[Citation Click] 🎯 Using precise location: "${exactText.substring(0, 60)}..."`)
            setHighlights([{
                pageNumber: 0,
                text: exactText,
                color: '#FFA500',  // Orange for precise
                citationIndex: citation.index,
                searchText: exactText,
                boundingRect: { x: 0, y: 0, width: 0, height: 0 }
            }])
            return
        }

        // PRIORITY 2: Use section text for search (first 200 chars)
        if (section && file) {
            const searchText = section  // Use section NAME like "Abstract", not full text!
            console.log(`[Citation Click] 🔍 Searching PDF for section text: "${searchText.substring(0, 60)}..."`)

            setHighlights([{
                pageNumber: 0,
                text: searchText,
                color: '#FFEB3B',  // Yellow for section text
                citationIndex: citation.index,
                searchText: searchText,
                boundingRect: { x: 0, y: 0, width: 0, height: 0 }
            }])

            console.log('[Citation Click]  Initiated text search')
        } else {
            console.log('[Citation Click] No text available for highlighting')
        }
    }

    // Feedback handler
    const handleFeedback = async (messageId: string, rating: 'like' | 'dislike', style?: string) => {
        const message = messages.find(m => m.id === messageId)
        if (!message) return

        console.log('[Feedback] Called with:', { messageId, rating, style })

        // If already liked, don't allow changes
        if (feedbackRatings[messageId] === 'like') {
            console.log('[Feedback] Already liked, ignoring')
            return
        }

        if (rating === 'like') {
            // Just save positive feedback
            setFeedbackRatings(prev => ({ ...prev, [messageId]: 'like' }))

            try {
                await fetch('http://localhost:3001/api/feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionId,
                        feedback: { rating: 'like' },
                        lastQuery: question,
                        lastAnswer: message.content
                    })
                })
                console.log('[Feedback] Like saved')
            } catch (err) {
                console.error('[Feedback] Error:', err)
            }
            return
        }

        // Dislike: Show style options first
        if (!style) {
            console.log('[Feedback] Showing style options')
            setShowStyleOptions(messageId)
            setFeedbackRatings(prev => ({ ...prev, [messageId]: 'dislike' }))
            return
        }

        // Regenerate with selected style
        console.log('[Feedback] Regenerating with style:', style)
        setIsRegenerating(true)
        try {
            const response = await fetch('http://localhost:3001/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId,
                    feedback: { rating: 'dislike', style },
                    lastQuery: question,
                    lastAnswer: message.content
                })
            })

            const data = await response.json()
            console.log('[Feedback] Response:', data)

            if (data.action === 'regenerated' && data.answer) {
                // Replace the answer in messages
                setMessages(prev => prev.map(msg =>
                    msg.id === messageId
                        ? { ...msg, content: data.answer, citations: data.citations }
                        : msg
                ))

                // Reset feedback for new answer
                setFeedbackRatings(prev => ({ ...prev, [messageId]: null }))
                setShowStyleOptions(null)
                console.log('[Feedback] Answer regenerated successfully')
            }
        } catch (err) {
            console.error('[Feedback] Error:', err)
            alert('Failed to regenerate answer')
        } finally {
            setIsRegenerating(false)
        }
    }


    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    // Redirect if no file
    useEffect(() => {
        if (!file) {
            navigate('/')
        }
    }, [file, navigate])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!question.trim() || isLoading) return

        const userQuestion = question.trim()
        setQuestion('')
        setError(null)

        // Add user question to messages
        const questionMsg: ChatMessage = {
            id: `q-${Date.now()}`,
            type: 'question',
            content: userQuestion,
            timestamp: new Date(),
        }
        setMessages(prev => [...prev, questionMsg])
        setIsLoading(true)

        try {
            // Upload PDF on first question, then reuse the path
            let pdfPath = uploadedPdfPath;

            if (!pdfPath && file) {
                console.log('[Upload] Uploading PDF file for first question...');
                const uploadResult = await api.uploadPDF(file);
                pdfPath = uploadResult.path;
                setUploadedPdfPath(pdfPath);
                console.log('[Upload] PDF uploaded to:', pdfPath);
            }

            console.log('[Query] Using PDF path:', pdfPath);

            // Call backend API with current expertise level
            console.log('[Query] Sending:', { sessionId, question: userQuestion, pdfPath, expertise });
            const response = await api.query({
                sessionId,
                question: userQuestion,
                sources: pdfPath ? [pdfPath] : [],
                expertise,
            });

            console.log('[Query] Response:', response);

            // Add answer to messages
            const answerMsg: ChatMessage = {
                id: `a-${Date.now()}`,
                type: 'answer',
                content: response.answer,
                citations: response.citations,
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, answerMsg]);
        } catch (err: any) {
            // Show more detailed error
            const errorMsg = err.response?.data?.message || err.response?.data?.error || err.message || 'Failed to get answer. Please try again.';
            setError(errorMsg);
            console.error('Query error:', err);
            console.error('Error details:', err.response?.data);
        } finally {
            setIsLoading(false)
        }
    }

    // Render answer text with clickable inline citations [1], [2], etc.
    const renderAnswerWithClickableCitations = (content: string, citations: any[]) => {
        // Pre-process: Convert [1] to markdown links [1](#citation-1) which are valid HTML anchors
        const markdownContent = content.replace(/\[(\d+)\]/g, '[$&](#citation-$1)');

        return (
            <div className="prose prose-sm max-w-none text-gray-800">
                <ReactMarkdown
                    components={{
                        a: ({ node, children, href, ...props }) => {
                            // Check if this is one of our citation links
                            if (href?.startsWith('#citation-')) {
                                const indexStr = href.replace('#citation-', '');
                                const citNum = parseInt(indexStr);
                                const citation = citations?.find(c => c.index === citNum);

                                // If it's a main paper citation, make it clickable and style it
                                if (citation?.evidenceChunk?.is_main_paper) {
                                    return (
                                        <span
                                            className="citation-link cursor-pointer text-blue-600 font-bold hover:underline"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                handleCitationClick(citation);
                                            }}
                                            title={`Click to highlight ${citation.evidenceChunk.section} in PDF`}
                                        >
                                            {children}
                                        </span>
                                    );
                                }
                                // External citation: Just style it, no click action (prevents navigation)
                                return (
                                    <span
                                        className="text-blue-600 font-semibold cursor-default"
                                        title={citation?.title || "External Reference"}
                                    >
                                        {children}
                                    </span>
                                );
                            }

                            // Normal external links - open in new tab
                            return <a href={href} className="text-blue-600 underline" target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
                        }
                    }}
                >
                    {markdownContent}
                </ReactMarkdown>
            </div>
        )
    }

    return (
        <div className="h-screen flex flex-col bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b px-6 py-4 flex items-center justify-between shadow-sm">
                <h1 className="text-2xl font-bold text-gray-900">RefHunters</h1>
                <button
                    onClick={() => navigate('/')}
                    className="text-blue-600 hover:text-blue-700 font-medium"
                >
                    New Chat
                </button>
            </header>

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left: PDF Viewer */}
                <div className="w-1/2 border-r bg-gray-100">
                    {file && <PDFViewer file={file} highlights={highlights} />}
                </div>

                {/* Right: Chat Interface */}
                <div className="w-1/2 flex flex-col bg-white">
                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-4">
                        {messages.length === 0 ? (
                            <div className="text-center text-gray-500 mt-20">
                                <h2 className="text-2xl font-semibold text-gray-800 mb-2">Ask a question</h2>
                                <p className="text-gray-600">Get answers from your scientific paper</p>
                                <p className="text-sm text-gray-500 mt-2">Expertise: {expertise}</p>
                            </div>
                        ) : (
                            messages.map(msg => (
                                <div key={msg.id} className={`${msg.type === 'question' ? 'text-right' : ''}`}>
                                    {msg.type === 'question' ? (
                                        <div className="inline-block bg-blue-600 text-white px-4 py-2 rounded-lg max-w-md">
                                            {msg.content}
                                        </div>
                                    ) : (
                                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                            {renderAnswerWithClickableCitations(msg.content, msg.citations || [])}
                                            {msg.citations && msg.citations.length > 0 && (
                                                <div className="mt-4 pt-4 border-t">
                                                    <h4 className="font-semibold text-sm text-gray-700 mb-2">
                                                        References ({msg.citations.length})
                                                    </h4>
                                                    <div className="space-y-2">
                                                        {msg.citations.map(cit => (
                                                            <div
                                                                key={cit.index}
                                                                className={`text-xs p-2 rounded transition
                                                                    ${cit.evidenceChunk?.is_main_paper
                                                                        ? 'cursor-pointer hover:bg-blue-50 border-l-2 border-blue-500'
                                                                        : 'text-gray-600'
                                                                    }
                                                                    ${activeCitationIndex === cit.index ? 'bg-yellow-100' : ''}
                                                                `}
                                                                onClick={() => cit.evidenceChunk?.is_main_paper && handleCitationClick(cit)}
                                                                title={cit.evidenceChunk?.is_main_paper ? 'Click to highlight in PDF' : 'External reference'}
                                                            >
                                                                <div className="flex items-start gap-2">
                                                                    <span className="font-medium text-blue-600">[{cit.index}]</span>
                                                                    <div className="flex-1">
                                                                        <div>{cit.title} ({cit.year})</div>
                                                                        {cit.evidenceChunk?.is_main_paper && (
                                                                            <span className="inline-block mt-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                                                                Main Paper
                                                                            </span>
                                                                        )}
                                                                        {cit.section && (
                                                                            <span className="text-gray-500"> • Section: {cit.section}</span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Feedback buttons */}
                                            {msg.type === 'answer' && (
                                                <div className="mt-4 pt-4 border-t">
                                                    <p className="text-sm text-gray-600 mb-3">Was this answer helpful?</p>

                                                    {!feedbackRatings[msg.id] && (
                                                        <div className="flex gap-3">
                                                            <button
                                                                onClick={() => handleFeedback(msg.id, 'like')}
                                                                className="px-4 py-2 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg transition"
                                                                disabled={isRegenerating}
                                                            >
                                                                👍 Yes
                                                            </button>
                                                            <button
                                                                onClick={() => handleFeedback(msg.id, 'dislike')}
                                                                className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition"
                                                                disabled={isRegenerating}
                                                            >
                                                                👎 No
                                                            </button>
                                                        </div>
                                                    )}

                                                    {feedbackRatings[msg.id] === 'like' && (
                                                        <div className="text-green-600 font-medium">✓ Thanks for your feedback!</div>
                                                    )}

                                                    {feedbackRatings[msg.id] === 'dislike' && showStyleOptions === msg.id && !isRegenerating && (
                                                        <div className="mt-3">
                                                            <p className="text-sm mb-2 font-medium">How should we improve it?</p>
                                                            <div className="flex flex-wrap gap-2">
                                                                <button
                                                                    onClick={() => handleFeedback(msg.id, 'dislike', 'categorized')}
                                                                    className="px-3 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition text-sm"
                                                                >
                                                                    📋 More organized
                                                                </button>
                                                                <button
                                                                    onClick={() => handleFeedback(msg.id, 'dislike', 'shorter')}
                                                                    className="px-3 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition text-sm"
                                                                >
                                                                    ⚡ Shorter
                                                                </button>
                                                                <button
                                                                    onClick={() => handleFeedback(msg.id, 'dislike', 'longer')}
                                                                    className="px-3 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition text-sm"
                                                                >
                                                                    📖 More detailed
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {isRegenerating && (
                                                        <div className="flex items-center gap-2 text-blue-600">
                                                            <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" />
                                                            <span>Regenerating answer...</span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))
                        )}

                        {/* Loading indicator */}
                        {isLoading && (
                            <div className="flex items-center gap-2 text-gray-600">
                                <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" />
                                <span>Thinking...</span>
                            </div>
                        )}

                        {/* Error */}
                        {error && (
                            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                                {error}
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div className="border-t bg-white p-4">
                        <form onSubmit={handleSubmit} className="space-y-2">
                            {/* Expertise Selector */}
                            <div className="flex items-center gap-2 text-sm">
                                <label className="text-gray-600 font-medium">Expertise:</label>
                                <select
                                    value={expertise}
                                    onChange={(e) => setExpertise(e.target.value as any)}
                                    className="px-3 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    disabled={isLoading}
                                >
                                    <option value="novice">Beginner</option>
                                    <option value="intermediate">Intermediate</option>
                                    <option value="expert">Expert</option>
                                </select>
                            </div>

                            {/* Question Input */}
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={question}
                                    onChange={(e) => setQuestion(e.target.value)}
                                    placeholder="Ask a question about this paper..."
                                    disabled={isLoading}
                                    className="flex-1 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                                />
                                <button
                                    type="submit"
                                    disabled={!question.trim() || isLoading}
                                    className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed"
                                >
                                    Send
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    )
}
