export async function withErrorBoundary<T>(
    nodeName: string,
    fn: () => Promise<T>,
    fallback?: T
): Promise<T> {
    try {
        return await fn();
    } catch (error: any) {
        console.error(`\n[ERROR] Node "${nodeName}" failed:`, error.message);
        console.error(error.stack);

        if (fallback !== undefined) {
            console.log(`[RECOVERY] Node "${nodeName}" using fallback value`);
            return fallback;
        }

        throw error;
    }
}
