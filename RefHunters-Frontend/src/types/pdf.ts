export interface BoundingRect {
    x: number
    y: number
    width: number
    height: number
}

export interface Highlight {
    pageNumber: number
    boundingRect: BoundingRect
    color: string
    text?: string
    citationIndex?: number
    searchText?: string  // Text to search for in PDF
}
