
import { runA0 } from "./agents/a0/a0";
import dotenv from "dotenv";
import path from "path";

// Load .env explicitly. Assuming we are running from project root (package.json location)
const envPath = path.join(process.cwd(), ".env");
dotenv.config({ path: envPath });

console.log(`[CLI] Loading env from: ${envPath}`);
console.log(`[CLI] REDIS_URL present: ${!!process.env.REDIS_URL}`);

// Fallback for testing
if (!process.env.REDIS_URL) {
    console.warn("[CLI] WARNING: REDIS_URL not found in .env, using default: redis://localhost:6379");
    process.env.REDIS_URL = "redis://localhost:6379";
}

async function main() {
    // Get arguments from command line
    const args = process.argv.slice(2);
    const query = args[0];
    const pdfPath = args[1];

    if (!query) {
        console.error("Usage: npx tsx src/test-cli.ts <query> [pdf_path]");
        console.error("Example: npx tsx src/test-cli.ts 'Summarize this paper' ./uploads/paper.pdf");
        process.exit(1);
    }

    const sessionId = `cli-test-${Date.now()}`;
    console.log(`\n🚀 Starting CLI Test (Session: ${sessionId})`);
    console.log(`❓ Query: "${query}"`);
    if (pdfPath) console.log(`📄 PDF: ${pdfPath}`);

    try {
        const result = await runA0({
            sessionId,
            userInput: query,
            sources: pdfPath ? [path.resolve(pdfPath)] : [],
            expertise: "intermediate",
            format: "markdown"
        });

        console.log("\n✅ Result:");
        console.log("---------------------------------------------------");
        console.log(result.answer);
        console.log("---------------------------------------------------");

        if (result.citations && result.citations.length > 0) {
            console.log(`\n📚 Citations (${result.citations.length}):`);
            result.citations.forEach((c: any, i: number) => {
                console.log(`[${i + 1}] ${c.title} (${c.year})`);
            });
        }

    } catch (error) {
        console.error("\n❌ Error:", error);
    }
}

main();
