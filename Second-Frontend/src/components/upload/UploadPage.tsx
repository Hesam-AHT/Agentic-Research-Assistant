import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function UploadPage() {
    const [file, setFile] = useState<File | null>(null)
    const [expertise, setExpertise] = useState<'novice' | 'intermediate' | 'expert'>('intermediate')
    const navigate = useNavigate()

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0])
        }
    }

    const handleStart = () => {
        if (file) {
            navigate('/answer', {
                state: { file, expertise }
            })
        }
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
            <div className="max-w-2xl w-full p-8">
                {/* Header */}
                <div className="text-center mb-12">
                    <h1 className="text-5xl font-bold text-gray-900 mb-3">RefHunters</h1>
                    <p className="text-gray-600 text-lg">Simplify Hidden Scientific References</p>
                </div>

                {/* Upload Section */}
                <div className="bg-white rounded-2xl shadow-xl p-8">
                    {/* File Upload */}
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Upload PDF
                        </label>
                        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition cursor-pointer">
                            <input
                                type="file"
                                accept=".pdf"
                                onChange={handleFileChange}
                                className="hidden"
                                id="file-upload"
                            />
                            <label htmlFor="file-upload" className="cursor-pointer">
                                {file ? (
                                    <div className="text-green-600">
                                        <span className="text-2xl">📄</span>
                                        <p className="mt-2 font-medium">{file.name}</p>
                                    </div>
                                ) : (
                                    <div className="text-gray-500">
                                        <span className="text-4xl">📤</span>
                                        <p className="mt-2">Click to upload or drag and drop</p>
                                        <p className="text-sm">PDF files only</p>
                                    </div>
                                )}
                            </label>
                        </div>
                    </div>

                    {/* Expertise Level */}
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Expertise Level
                        </label>
                        <select
                            value={expertise}
                            onChange={(e) => setExpertise(e.target.value as any)}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                            <option value="novice">Beginner</option>
                            <option value="intermediate">Intermediate</option>
                            <option value="expert">Expert</option>
                        </select>
                    </div>

                    {/* Start Button */}
                    <button
                        onClick={handleStart}
                        disabled={!file}
                        className="w-full bg-blue-600 text-white py-4 rounded-lg font-semibold text-lg
                     hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed
                     transition shadow-lg hover:shadow-xl"
                    >
                        Get Answer
                    </button>
                </div>
            </div>
        </div>
    )
}
