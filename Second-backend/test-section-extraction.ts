/**
 * Test script for Grobid section extraction
 * Tests the new section-based evidence creation
 */

import { run as runA1 } from './src/agents/a1/a1.js';
import * as path from 'path';

async function testSectionExtraction() {
    console.log('\n' + '='.repeat(60));
    console.log('TESTING GROBID SECTION EXTRACTION');
    console.log('='.repeat(60));

    // Use an existing PDF from uploads
    const testPdf = path.resolve('uploads/Huynh_Progressive_Semantic_Segmentation_CVPR_2021_paper-1767538914047.pdf');

    console.log(`\nTest PDF: ${path.basename(testPdf)}`);
    console.log('\n[TEST] Step 1: Running ingest_parse to extract sections...\n');

    try {
        // Test ingest_parse action
        const ingestResult = await runA1({
            agent: 'A1',
            action: 'ingest_parse',
            inputs: {
                sources: [testPdf]
            }
        });

        console.log('\n' + '='.repeat(60));
        console.log('INGEST RESULTS');
        console.log('='.repeat(60));
        console.log(`Status: ${ingestResult.status}`);
        console.log(`Citations extracted: ${ingestResult.citations?.length || 0}`);
        console.log(`Evidence chunks created: ${ingestResult.evidence?.length || 0}`);

        if (ingestResult.evidence && ingestResult.evidence.length > 0) {
            console.log('\n📋 EVIDENCE CHUNKS (Sections):');
            console.log('-'.repeat(60));

            ingestResult.evidence.forEach((evidence: any, index: number) => {
                console.log(`\n[${index + 1}] ${evidence.section || 'No section'}`);
                console.log(`  📄 Page: ${evidence.page || 'N/A'}`);
                console.log(`  🆔 Chunk ID: ${evidence.chunk_id || 'N/A'}`);
                console.log(`  📏 Text length: ${evidence.text?.length || 0} chars`);
                console.log(`  🏷️  Is main paper: ${evidence.is_main_paper ? 'YES' : 'NO'}`);
                if (evidence.text) {
                    console.log(`  📝 Preview: "${evidence.text.substring(0, 80)}..."`);
                }
            });

            // Check if we have section metadata
            const sectionsFound = ingestResult.evidence.filter((e: any) => e.section).length;
            const mainPaperChunks = ingestResult.evidence.filter((e: any) => e.is_main_paper).length;

            console.log('\n' + '='.repeat(60));
            console.log('VERIFICATION');
            console.log('='.repeat(60));
            console.log(`✓ Evidence chunks with sections: ${sectionsFound}/${ingestResult.evidence.length}`);
            console.log(`✓ Main paper chunks: ${mainPaperChunks}`);

            if (sectionsFound > 0) {
                console.log('\n✅ SUCCESS! Section extraction working correctly!');
                console.log('   Sections found:', ingestResult.evidence
                    .filter((e: any) => e.section)
                    .map((e: any) => e.section)
                    .join(', '));
            } else {
                console.log('\n⚠️  WARNING: No sections found - check if Grobid is running');
            }
        }

        // Test retrieve action with locations
        console.log('\n\n' + '='.repeat(60));
        console.log('[TEST] Step 2: Testing retrieve action with locations...');
        console.log('='.repeat(60));

        const retrieveResult = await runA1({
            agent: 'A1',
            action: 'retrieve',
            inputs: {
                query: 'semantic segmentation accuracy',
                topN: 10,
                topK: 5,
                sources: [testPdf]
            }
        });

        console.log(`\nRetrieve Status: ${retrieveResult.status}`);
        console.log(`Evidence returned: ${retrieveResult.evidence?.length || 0}`);

        if (retrieveResult.evidence && retrieveResult.evidence.length > 0) {
            const evidenceWithLocations = retrieveResult.evidence.filter((e: any) =>
                e.locations && e.locations.length > 0
            );

            console.log(`\n📍 Evidence chunks with precise locations: ${evidenceWithLocations.length}`);

            if (evidenceWithLocations.length > 0) {
                console.log('\n📋 LOCATION DETAILS:');
                evidenceWithLocations.slice(0, 2).forEach((evidence: any, idx: number) => {
                    console.log(`\n[${idx + 1}] ${evidence.title || 'Untitled'}`);
                    evidence.locations.forEach((loc: any, locIdx: number) => {
                        console.log(`  Location ${locIdx + 1}:`);
                        console.log(`    - Paragraph: ${loc.paragraph}`);
                        console.log(`    - Line: ${loc.line}`);
                        console.log(`    - Sentence: "${loc.start_sentence.substring(0, 60)}..."`);
                    });
                });
                console.log('\n✅ SUCCESS! Location-based highlighting data available!');
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('TEST COMPLETE');
        console.log('='.repeat(60));

    } catch (error) {
        console.error('\n❌ TEST FAILED:', error);
        if (error instanceof Error) {
            console.error('Error message:', error.message);
            console.error('Stack:', error.stack);
        }
    }
}

// Run the test
testSectionExtraction().then(() => {
    console.log('\n✓ Test script finished\n');
    process.exit(0);
}).catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
});
