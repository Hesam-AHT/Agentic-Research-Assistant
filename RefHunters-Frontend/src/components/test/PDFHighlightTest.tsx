import React, { useState } from 'react'
import PDFViewer from '../shared/PDFViewer'

/**
 * Test page for PDF highlighting - no backend needed!
 * Tests the section search and highlighting functionality
 */
export default function PDFHighlightTest() {
    const [file, setFile] = useState<File | null>(null)
    const [highlights, setHighlights] = useState<any[]>([])
    const [testResults, setTestResults] = useState<string[]>([])

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const uploadedFile = e.target.files?.[0]
        if (uploadedFile && uploadedFile.type === 'application/pdf') {
            setFile(uploadedFile)
            addTestResult('✅ PDF loaded successfully')
        }
    }

    const addTestResult = (message: string) => {
        setTestResults(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`])
    }

    // Test 1: Highlight "MagNet" section
    const testMagNetHighlight = () => {
        addTestResult('🔍 Test 1: Searching for "MagNet" section...')

        const mockCitation = {
            index: 1,
            title: 'Main Paper',
            evidenceChunk: {
                section: 'MagNet',
                is_main_paper: true
            }
        }

        // Trigger search-based highlighting
        setHighlights([{
            pageNumber: 0,  // Will be found by search
            text: 'MagNet',
            color: '#FFEB3B',
            citationIndex: 1,
            searchText: 'MagNet',  // Trigger text search
            boundingRect: { x: 0, y: 0, width: 0, height: 0 }
        }])

        addTestResult('✅ Highlight triggered for "MagNet"')
        addTestResult('📄 Check PDF viewer - should show yellow highlight on MagNet section')
    }

    // Test 2: Highlight "Introduction" section
    const testIntroductionHighlight = () => {
        addTestResult('🔍 Test 2: Searching for "Introduction" section...')

        setHighlights([{
            pageNumber: 0,
            text: 'Introduction',
            color: '#4CAF50',  // Green
            citationIndex: 2,
            searchText: 'Introduction',
            boundingRect: { x: 0, y: 0, width: 0, height: 0 }
        }])

        addTestResult('✅ Highlight triggered for "Introduction"')
    }

    // Test 3: Multiple highlights
    const testMultipleHighlights = () => {
        addTestResult('🔍 Test 3: Multiple sections...')

        setHighlights([
            {
                pageNumber: 0,
                text: 'Abstract',
                color: '#FF5722',  // Orange
                citationIndex: 3,
                searchText: 'Abstract',
                boundingRect: { x: 0, y: 0, width: 0, height: 0 }
            },
            {
                pageNumber: 0,
                text: 'Conclusion',
                color: '#9C27B0',  // Purple
                citationIndex: 4,
                searchText: 'Conclusion',
                boundingRect: { x: 0, y: 0, width: 0, height: 0 }
            }
        ])

        addTestResult('✅ Multiple highlights triggered')
    }

    // Clear highlights
    const clearHighlights = () => {
        setHighlights([])
        addTestResult('🗑️ Highlights cleared')
    }

    return (
        <div className="h-screen flex flex-col bg-gray-50">
            {/* Header */}
            <header className="bg-blue-600 text-white px-6 py-4">
                <h1 className="text-2xl font-bold">🧪 PDF Highlighting Test Page</h1>
                <p className="text-sm text-blue-100 mt-1">No backend required - Test the highlighting feature!</p>
            </header>

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left: PDF Viewer */}
                <div className="w-1/2 border-r bg-gray-100">
                    {file ? (
                        <PDFViewer file={file} highlights={highlights} />
                    ) : (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center p-8">
                                <div className="text-6xl mb-4">📄</div>
                                <h3 className="text-xl font-semibold text-gray-700 mb-2">Upload a PDF</h3>
                                <p className="text-gray-500 mb-4">Choose a scientific paper PDF to test highlighting</p>
                                <label className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg cursor-pointer hover:bg-blue-700">
                                    Select PDF File
                                    <input
                                        type="file"
                                        accept=".pdf"
                                        onChange={handleFileUpload}
                                        className="hidden"
                                    />
                                </label>
                            </div>
                        </div>
                    )}
                </div>

                {/* Right: Test Controls */}
                <div className="w-1/2 flex flex-col bg-white">
                    {/* Test Buttons */}
                    <div className="p-6 border-b">
                        <h2 className="text-xl font-bold text-gray-800 mb-4">Test Controls</h2>

                        {!file && (
                            <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
                                <p className="text-yellow-800 text-sm">⚠️ Upload a PDF first to run tests</p>
                            </div>
                        )}

                        <div className="space-y-3">
                            <button
                                onClick={testMagNetHighlight}
                                disabled={!file}
                                className="w-full bg-yellow-500 text-white px-4 py-3 rounded-lg font-medium hover:bg-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                🧲 Test 1: Highlight "MagNet" Section
                            </button>

                            <button
                                onClick={testIntroductionHighlight}
                                disabled={!file}
                                className="w-full bg-green-500 text-white px-4 py-3 rounded-lg font-medium hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                📖 Test 2: Highlight "Introduction"
                            </button>

                            <button
                                onClick={testMultipleHighlights}
                                disabled={!file}
                                className="w-full bg-purple-500 text-white px-4 py-3 rounded-lg font-medium hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                🎨 Test 3: Multiple Highlights
                            </button>

                            <button
                                onClick={clearHighlights}
                                disabled={!file}
                                className="w-full bg-gray-500 text-white px-4 py-3 rounded-lg font-medium hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                🗑️ Clear Highlights
                            </button>
                        </div>

                        {file && (
                            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
                                <div className="flex items-center gap-2">
                                    <div className="text-2xl">📄</div>
                                    <div>
                                        <div className="font-medium text-blue-900">{file.name}</div>
                                        <div className="text-sm text-blue-600">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Test Results Log */}
                    <div className="flex-1 overflow-y-auto p-6">
                        <h3 className="text-lg font-bold text-gray-800 mb-3">Test Results</h3>

                        {testResults.length === 0 ? (
                            <div className="text-gray-500 text-sm italic">
                                No tests run yet. Click a test button above to start.
                            </div>
                        ) : (
                            <div className="space-y-2 font-mono text-sm">
                                {testResults.map((result, idx) => (
                                    <div
                                        key={idx}
                                        className="p-2 bg-gray-50 border border-gray-200 rounded"
                                    >
                                        {result}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Instructions */}
                    <div className="p-6 border-t bg-gray-50">
                        <h3 className="font-bold text-gray-800 mb-2">📋 How to Test:</h3>
                        <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
                            <li>Upload your scientific PDF (e.g., MagNet paper)</li>
                            <li>Click "Test 1: Highlight MagNet Section"</li>
                            <li>Check the PDF viewer on the left</li>
                            <li>Look for yellow highlight box on the "MagNet" section</li>
                            <li>Open browser console (F12) to see search logs</li>
                        </ol>
                    </div>
                </div>
            </div>
        </div>
    )
}
