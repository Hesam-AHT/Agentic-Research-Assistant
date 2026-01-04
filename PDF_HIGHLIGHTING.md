# PDF Highlighting - Simple Guide

How PDF section highlighting works in RefHunters.

---

## Files Involved

| File | What It Does |
|------|--------------|
| `PDFViewer.tsx` | Main highlighting logic - searches for sections and renders yellow boxes |
| `AnswerPage.tsx` | Triggers highlighting when user clicks citations |
| `pdf.ts` | Type definition for `Highlight` interface |
| `PDFHighlightTest.tsx` | Test page to try highlighting without backend |

---

## How It Works

1. **User clicks citation** → AnswerPage extracts section name (e.g., "MagNet")
2. **PDFViewer receives** → `searchText: "MagNet"` in highlights prop
3. **Search algorithm runs:**
   - Loops through PDF pages
   - Finds headings (text 20% larger than average)
   - Locates "MagNet" heading
   - Finds next heading (section boundary)
   - Creates yellow box covering entire section
4. **Yellow highlight appears** on PDF

---

## Testing

### Test Page (No Backend)

1. Start frontend: `cd RefHunters-Frontend && npm run dev`
2. Open: http://localhost:5173/test-highlight
3. Upload a PDF
4. Click test buttons to see highlighting

### Full App (With Backend)

1. Start all services
2. Upload PDF and ask question
3. Click citation [1] in answer
4. PDF highlights that section

---

## Key Code

### PDFViewer.tsx

**Search function** (lines 44-161):
```typescript
searchAndHighlightText(searchText, citationIndex)
```

**What it does:**
- Extracts text from each PDF page
- Finds headings by font size
- Matches section name
- Calculates bounding box
- Renders yellow highlight

### AnswerPage.tsx

**Citation click** (lines 26-61):
```typescript
handleCitationClick = (citation) => {
    setHighlights([{
        searchText: citation.section,  // "MagNet"
        color: '#FFEB3B'
    }])
}
```

---

## Debugging

**Open browser console (F12)** to see:
```
[PDFViewer] 🔍 Starting search for section: "MagNet"
[PDFViewer] Found 12 heading(s)
[PDFViewer] ✅ FOUND target at index 2: "3.1 MagNet"
[PDFViewer] ✅ Highlight created successfully
```

**If no highlight appears:**
- Check console for errors
- Verify section name exists in PDF
- Try different section ("Introduction", "Abstract")

---

## Quick Reference

**Test URL:** http://localhost:5173/test-highlight  
**Main file:** `PDFViewer.tsx`  
**Search function:** `searchAndHighlightText()` (lines 44-161)  
**Console tag:** `[PDFViewer]`
