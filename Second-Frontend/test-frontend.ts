#!/usr/bin/env npx tsx
/// <reference types="node" />
/**
 * Simple Frontend API Test Script
 * 
 * Usage:
 *   npx tsx test-frontend.ts <question> <expertise> <pdf-path>
 * 
 * Example:
 *   npx tsx test-frontend.ts "What is GLNet?" intermediate ../uploads/paper.pdf
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';

const API_URL = process.env.VITE_API_URL || 'http://localhost:3000';

async function main() {
    // Parse command-line arguments
    const args = process.argv.slice(2);

    if (args.length < 3) {
        console.error('Error: Missing required arguments');
        console.error('');
        console.error('Usage: npx tsx test-frontend.ts <question> <expertise> <pdf-path>');
        console.error('');
        console.error('Arguments:');
        console.error('  question   - Your research question (string)');
        console.error('  expertise  - Your expertise level: beginner | intermediate | expert');
        console.error('  pdf-path   - Path to the PDF file');
        console.error('');
        console.error('Example:');
        console.error('  npx tsx test-frontend.ts "What is MagNet?" intermediate ../uploads/paper.pdf');
        process.exit(1);
    }

    const [question, expertise, pdfPath] = args;

    // Validate expertise level
    const validExpertise = ['beginner', 'intermediate', 'expert'];
    if (!validExpertise.includes(expertise)) {
        console.error(` Error: Invalid expertise level "${expertise}"`);
        console.error(`   Must be one of: ${validExpertise.join(', ')}`);
        process.exit(1);
    }

    // Validate PDF path
    const absolutePdfPath = path.resolve(pdfPath);

    if (!fs.existsSync(absolutePdfPath)) {
        console.error(`Error: PDF file not found: ${absolutePdfPath}`);
        process.exit(1);
    }

    console.log('='.repeat(80));
    console.log(' FRONTEND API TEST - RefHunters');
    console.log('='.repeat(80));
    console.log('');
    console.log(` API URL:   ${API_URL}`);
    console.log(` PDF:       ${absolutePdfPath}`);
    console.log(` Question:  ${question}`);
    console.log(` Expertise: ${expertise}`);
    console.log('');

    try {
        // Step 1: Upload PDF
        console.log(' Step 1: Uploading PDF...');
        const formData = new FormData();
        formData.append('pdf', fs.createReadStream(absolutePdfPath));

        const uploadResponse = await axios.post(`${API_URL}/upload`, formData, {
            headers: formData.getHeaders(),
        });

        const { pdfPath: serverPdfPath, sessionId } = uploadResponse.data;
        console.log(`    Upload successful`);
        console.log(`    Server path: ${serverPdfPath}`);
        console.log(`    Session ID: ${sessionId}`);
        console.log('');

        // Step 2: Submit query
        console.log(' Step 2: Submitting query...');
        const queryResponse = await axios.post(`${API_URL}/query`, {
            sessionId,
            userInput: question,
            expertise
        });

        const result = queryResponse.data;

        console.log('');
        console.log('='.repeat(80));
        console.log(' RESULTS');
        console.log('='.repeat(80));
        console.log('');
        console.log(' Answer:');
        console.log(result.answer);
        console.log('');
        console.log(` Citations (${result.citations.length}):`);
        result.citations.forEach((citation: any, index: number) => {
            console.log(`  [${index + 1}] ${citation.title || 'Untitled'}`);
            if (citation.section) console.log(`      Section: ${citation.section}`);
            if (citation.page) console.log(`      Page: ${citation.page}`);
        });
        console.log('');
        console.log(' Test completed successfully');

    } catch (error: any) {
        console.error('');
        console.error('='.repeat(80));
        console.error(' ERROR');
        console.error('='.repeat(80));

        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error('Response:', error.response.data);
        } else if (error.request) {
            console.error('No response received from server');
            console.error(`Is the backend running at ${API_URL}?`);
        } else {
            console.error(error.message);
        }

        if (error.stack) {
            console.error('');
            console.error('Stack trace:');
            console.error(error.stack);
        }
        process.exit(1);
    }
}

// Run the test
main();
