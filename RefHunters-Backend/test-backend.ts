#!/usr/bin/env npx tsx
/**
 * Simple Backend Test Script
 * 
 * Usage:
 *   npx tsx test-backend.ts <question> <expertise> <pdf-path>
 * 
 * Example:
 *   npx tsx test-backend.ts "What is GLNet?" intermediate ./uploads/paper.pdf
 */

import { executeQuery } from './src/index.js';
import * as path from 'path';

async function main() {
    // Parse command-line arguments
    const args = process.argv.slice(2);

    if (args.length < 3) {
        console.error('❌ Error: Missing required arguments');
        console.error('');
        console.error('Usage: npx tsx test-backend.ts <question> <expertise> <pdf-path>');
        console.error('');
        console.error('Arguments:');
        console.error('  question   - Your research question (string)');
        console.error('  expertise  - Your expertise level: beginner | intermediate | expert');
        console.error('  pdf-path   - Path to the PDF file');
        console.error('');
        console.error('Example:');
        console.error('  npx tsx test-backend.ts "What is MagNet architecture?" intermediate ./uploads/paper.pdf');
        process.exit(1);
    }

    const [question, expertise, pdfPath] = args;

    // Validate expertise level
    const validExpertise = ['beginner', 'intermediate', 'expert'];
    if (!validExpertise.includes(expertise)) {
        console.error(`❌ Error: Invalid expertise level "${expertise}"`);
        console.error(`   Must be one of: ${validExpertise.join(', ')}`);
        process.exit(1);
    }

    // Validate PDF path
    const absolutePdfPath = path.resolve(pdfPath);

    console.log('='.repeat(80));
    console.log('🧪 BACKEND TEST - Agentic Research Assistant');
    console.log('='.repeat(80));
    console.log('');
    console.log(`📄 PDF:       ${absolutePdfPath}`);
    console.log(`❓ Question:  ${question}`);
    console.log(`👤 Expertise: ${expertise}`);
    console.log('');
    console.log('🚀 Starting backend workflow...');
    console.log('');

    try {
        // Execute query with sources array
        const result = await executeQuery(
            `test-${Date.now()}`,
            question,
            [{ path: absolutePdfPath, type: 'pdf' }]
        );

        console.log('='.repeat(80));
        console.log('✅ RESULTS');
        console.log('='.repeat(80));
        console.log('');
        console.log('📝 Answer:');
        console.log(result.answer);
        console.log('');
        console.log(`📚 Citations (${result.citations?.length || 0}):`);
        result.citations?.forEach((citation: any, index: number) => {
            console.log(`  [${index + 1}] ${citation.title || 'Untitled'}`);
            if (citation.section) console.log(`      Section: ${citation.section}`);
            if (citation.page) console.log(`      Page: ${citation.page}`);
        });
        console.log('');
        console.log('✅ Test completed successfully');

    } catch (error: any) {
        console.error('');
        console.error('='.repeat(80));
        console.error('❌ ERROR');
        console.error('='.repeat(80));
        console.error(error.message);
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
