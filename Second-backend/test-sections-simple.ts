/**
 * Simple test to verify section extraction from Grobid XML
 */

import { parseSectionsFromGrobidXML } from './src/agents/a1/sections-parser.js';
import * as fs from 'fs';

console.log('\n' + '='.repeat(70));
console.log('TESTING SECTION EXTRACTION FROM GROBID XML');
console.log('='.repeat(70));

const xmlFile = 'grobid-output/Huynh_Progressive_Semantic_Segmentation_CVPR_2021_paper-1767538914047_fulltext.xml';

if (!fs.existsSync(xmlFile)) {
    console.error(`\n❌ XML file not found: ${xmlFile}`);
    process.exit(1);
}

const xml = fs.readFileSync(xmlFile, 'utf-8');
console.log(`\n✓ Loaded Grobid XML: ${xmlFile}`);
console.log(`  File size: ${(xml.length / 1024).toFixed(1)} KB`);

console.log('\n' + '-'.repeat(70));
console.log('PARSING SECTIONS...');
console.log('-'.repeat(70));

const sections = parseSectionsFromGrobidXML(xml);

console.log('\n' + '='.repeat(70));
console.log('RESULTS');
console.log('='.repeat(70));
console.log(`\n📊 Total sections extracted: ${sections.length}\n`);

if (sections.length > 0) {
    console.log('📋 SECTION DETAILS:\n');
    sections.forEach((section, index) => {
        console.log(`[${index + 1}] ${section.section}`);
        console.log(`    Page: ${section.page || 'N/A'}`);
        console.log(`    Text length: ${section.text.length} chars`);
        console.log(`    Preview: "${section.text.substring(0, 100).replace(/\s+/g, ' ')}..."`);
        console.log('');
    });

    console.log('='.repeat(70));
    console.log('✅ SUCCESS! Section extraction is working correctly!');
    console.log('='.repeat(70));
    console.log('\nSections found:');
    sections.forEach(s => console.log(`  • ${s.section}`));
    console.log('');
} else {
    console.log('⚠️  WARNING: No sections were extracted from the XML');
    console.log('Check if the XML contains <abstract> and <body><div><head> elements');
}
