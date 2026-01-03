import { useState, useEffect } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import type { Highlight } from '../../types/pdf'

// Configure PDF.js worker - use npm package
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString()

interface PDFViewerProps {
    file: File
    highlights?: Highlight[]
}

export default function PDFViewer({ file, highlights = [] }: PDFViewerProps) {
    const [numPages, setNumPages] = useState<number>(0)
    const [scale, setScale] = useState<number>(1.5)
    const [pdfUrl, setPdfUrl] = useState<string>('')
    const [pdfDocument, setPdfDocument] = useState<any>(null)
    const [searchHighlights, setSearchHighlights] = useState<any[]>([])  // Local highlights from search

    // Debug: Log when highlights change
    useEffect(() => {
        console.log('[PDFViewer] Highlights prop changed:', highlights)
        console.log('[PDFViewer] Number of highlights:', highlights.length)
        if (highlights.length > 0) {
            highlights.forEach((h, i) => {
                console.log(`[PDFViewer]   Highlight ${i}:`, h)
                console.log(`[PDFViewer]     Page: ${h.pageNumber}, Color: ${h.color}`)
                console.log(`[PDFViewer]     BoundingRect:`, h.boundingRect)
                console.log(`[PDFViewer]     SearchText: ${h.searchText}`)
            })

            // If highlight has searchText, search for it in PDF
            const searchHighlight = highlights.find(h => h.searchText)
            if (searchHighlight && pdfDocument && searchHighlight.searchText) {
                console.log('[PDFViewer] 🔍 Searching for text:', searchHighlight.searchText)
                searchAndHighlightText(searchHighlight.searchText, searchHighlight.citationIndex || 0)
            }
        }
    }, [highlights, pdfDocument])

    // Search for text across all pages and create highlights
    const searchAndHighlightText = async (searchText: string, citationIndex: number) => {
        if (!pdfDocument) return

        console.log(`[PDFViewer] 🔍 Starting search for section: "${searchText}"`)
        const newHighlights: any[] = []

        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            try {
                const page = await pdfDocument.getPage(pageNum)
                const textContent = await page.getTextContent()
                const viewport = page.getViewport({ scale: 1 })

                const allItems = textContent.items
                if (allItems.length === 0) continue

                console.log(`[PDFViewer] Page ${pageNum}: ${allItems.length} text items`)

                // Calculate average text height
                const avgHeight = allItems.reduce((sum: number, i: any) => sum + (i.height || 0), 0) / allItems.length
                console.log(`[PDFViewer] Average text height: ${avgHeight.toFixed(2)}px`)

                // Find ALL headings on this page (use lower threshold: 1.2x instead of 1.3x)
                const allHeadings: Array<{ item: any, index: number, y: number }> = []
                allItems.forEach((item: any, idx: number) => {
                    if (item.str && item.height && item.transform && item.height > avgHeight * 1.2) {
                        const y = item.transform[5]
                        allHeadings.push({ item, index: idx, y })
                    }
                })

                console.log(`[PDFViewer] Found ${allHeadings.length} heading(s)`)
                allHeadings.forEach((h, i) => {
                    console.log(`[PDFViewer]   Heading ${i}: "${h.item.str}" (height: ${h.item.height.toFixed(2)}, idx: ${h.index}, Y: ${h.y.toFixed(2)})`)
                })

                // Sort headings by Y position (descending = top to bottom in visual order)
                allHeadings.sort((a, b) => b.y - a.y)

                // Find our target heading
                const searchLower = searchText.toLowerCase()
                let targetHeadingIndex = -1

                for (let i = 0; i < allHeadings.length; i++) {
                    if (allHeadings[i].item.str.toLowerCase().includes(searchLower)) {
                        targetHeadingIndex = i
                        console.log(`[PDFViewer] ✅ FOUND target at index ${i}: "${allHeadings[i].item.str}"`)
                        break
                    }
                }

                if (targetHeadingIndex === -1) {
                    console.log(`[PDFViewer] Target heading "${searchText}" not found on page ${pageNum}`)
                    continue
                }

                const targetHeading = allHeadings[targetHeadingIndex]
                const nextHeading = allHeadings[targetHeadingIndex + 1]

                // Calculate section boundaries
                const startItemIdx = targetHeading.index
                const endItemIdx = nextHeading ? nextHeading.index : allItems.length

                console.log(`[PDFViewer] Section boundaries:`)
                console.log(`[PDFViewer]   Start: item ${startItemIdx} "${targetHeading.item.str}"`)
                console.log(`[PDFViewer]   End: item ${endItemIdx} ${nextHeading ? `"${nextHeading.item.str}"` : '(end of page)'}`)
                console.log(`[PDFViewer]   Total items in section: ${endItemIdx - startItemIdx}`)

                // Calculate exact bounding box
                let minX = Infinity, minY = Infinity
                let maxX = -Infinity, maxY = -Infinity
                let itemsProcessed = 0

                for (let i = startItemIdx; i < endItemIdx; i++) {
                    const item = allItems[i]
                    if (item.transform && item.width && item.height) {
                        const x = item.transform[4]
                        const y = item.transform[5]

                        minX = Math.min(minX, x)
                        minY = Math.min(minY, y)
                        maxX = Math.max(maxX, x + item.width)
                        maxY = Math.max(maxY, y + item.height)
                        itemsProcessed++
                    }
                }

                console.log(`[PDFViewer] Bounding box calculation:`)
                console.log(`[PDFViewer]   Processed ${itemsProcessed} items with coordinates`)
                console.log(`[PDFViewer]   Raw PDF coords: minX=${minX.toFixed(2)}, maxX=${maxX.toFixed(2)}, minY=${minY.toFixed(2)}, maxY=${maxY.toFixed(2)}`)

                if (minX === Infinity) {
                    console.log(`[PDFViewer] ❌ No valid coordinates found`)
                    continue
                }

                // Add padding
                const padding = 15
                minX = Math.max(0, minX - padding)
                maxX = Math.min(viewport.width, maxX + padding)
                minY = Math.max(0, minY - padding)
                maxY = Math.min(viewport.height, maxY + padding)

                // Convert to DOM coordinates (Y from top)
                const boxX = minX
                const boxY = viewport.height - maxY
                const boxWidth = maxX - minX
                const boxHeight = maxY - minY

                console.log(`[PDFViewer] Final highlight box:`)
                console.log(`[PDFViewer]   Position: (${boxX.toFixed(2)}, ${boxY.toFixed(2)})`)
                console.log(`[PDFViewer]   Size: ${boxWidth.toFixed(2)}w × ${boxHeight.toFixed(2)}h`)
                console.log(`[PDFViewer]   Viewport: ${viewport.width}w × ${viewport.height}h`)

                newHighlights.push({
                    pageNumber: pageNum,
                    text: searchText,
                    color: '#FFEB3B',
                    citationIndex,
                    boundingRect: {
                        x: boxX,
                        y: boxY,
                        width: boxWidth,
                        height: boxHeight
                    }
                })

                console.log(`[PDFViewer] ✅ Highlight created successfully`)
                break
            } catch (error) {
                console.error(`[PDFViewer] Error on page ${pageNum}:`, error)
            }
        }

        if (newHighlights.length > 0) {
            console.log(`[PDFViewer] 🎯 Setting ${newHighlights.length} highlight(s)`)
            setSearchHighlights(newHighlights)
        } else {
            console.log(`[PDFViewer] ⚠️ No section found for "${searchText}"`)
            setSearchHighlights([])
        }
    }

    // Create object URL from file
    useEffect(() => {
        if (file) {
            const url = URL.createObjectURL(file)
            setPdfUrl(url)

            // Cleanup object URL on unmount
            return () => {
                URL.revokeObjectURL(url)
            }
        }
    }, [file])

    const onDocumentLoadSuccess = (pdf: any) => {
        setNumPages(pdf.numPages)
        setPdfDocument(pdf)
        console.log('[PDFViewer] ✅ PDF document loaded, text search enabled')
        console.log('[PDFViewer] Pages:', pdf.numPages)
    }

    const zoomIn = () => {
        setScale(prev => Math.min(2.0, prev + 0.1))
    }

    const zoomOut = () => {
        setScale(prev => Math.max(0.5, prev - 0.1))
    }

    return (
        <div className="h-full flex flex-col bg-gray-100">
            {/* Controls */}
            <div className="bg-white border-b p-3 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700">
                        {numPages > 0 ? `${numPages} pages` : 'Loading...'}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={zoomOut}
                        className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700"
                        title="Zoom out"
                    >
                        -
                    </button>
                    <span className="text-sm text-gray-700 min-w-[50px] text-center">
                        {Math.round(scale * 100)}%
                    </span>
                    <button
                        onClick={zoomIn}
                        className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700"
                        title="Zoom in"
                    >
                        +
                    </button>
                </div>
            </div>

            {/* Continuous PDF Display - All Pages */}
            <div className="flex-1 overflow-y-auto overflow-x-auto p-4">
                <div className="flex flex-col items-center gap-4">
                    <Document
                        file={pdfUrl}
                        onLoadSuccess={onDocumentLoadSuccess}
                        loading={
                            <div className="flex items-center gap-2 text-gray-600">
                                <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
                                <span>Loading PDF...</span>
                            </div>
                        }
                        error={
                            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                                Failed to load PDF. Please try another file.
                            </div>
                        }
                    >
                        {/* Render ALL pages */}
                        {Array.from(new Array(numPages), (_, index) => {
                            const pageNum = index + 1
                            // Use searchHighlights (from text search) instead of highlights prop
                            const pageHighlights = searchHighlights.filter(h => h.pageNumber === pageNum)

                            if (pageHighlights.length > 0) {
                                console.log(`[PDFViewer] 📍 Page ${pageNum} has ${pageHighlights.length} highlights to render`)
                            }

                            return (
                                <div key={`page_${pageNum}`} className="relative mb-4 shadow-lg">
                                    <Page
                                        pageNumber={pageNum}
                                        scale={scale}
                                        renderTextLayer={true}
                                        renderAnnotationLayer={true}
                                    />

                                    {/* Highlight Overlays for this page */}
                                    {pageHighlights.map((highlight, idx) => {
                                        console.log(`[PDFViewer] 🟨 Rendering highlight ${idx} on page ${pageNum}:`, highlight.boundingRect)
                                        return (
                                            <div
                                                key={idx}
                                                className="absolute pointer-events-none"
                                                style={{
                                                    left: `${highlight.boundingRect.x * scale}px`,
                                                    top: `${highlight.boundingRect.y * scale}px`,
                                                    width: `${highlight.boundingRect.width * scale}px`,
                                                    height: `${highlight.boundingRect.height * scale}px`,
                                                    backgroundColor: highlight.color,
                                                    opacity: 0.3,
                                                    border: `2px solid ${highlight.color}`,
                                                    zIndex: 10,  // Ensure it's on top
                                                }}
                                                title={highlight.text || `Citation ${highlight.citationIndex}`}
                                            />
                                        )
                                    })}

                                    {/* Page number indicator */}
                                    <div className="absolute bottom-2 right-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs">
                                        Page {pageNum}
                                    </div>
                                </div>
                            )
                        })}
                    </Document>
                </div>
            </div>
        </div>
    )
}
