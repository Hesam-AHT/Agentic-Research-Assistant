import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import UploadPage from './components/upload/UploadPage'
import AnswerPage from './components/answer/AnswerPage'
import PDFHighlightTest from './components/test/PDFHighlightTest'

function App() {
    return (
        <Router>
            <Routes>
                <Route path="/" element={<UploadPage />} />
                <Route path="/answer" element={<AnswerPage />} />
                <Route path="/test-highlight" element={<PDFHighlightTest />} />
            </Routes>
        </Router>
    )
}

export default App
