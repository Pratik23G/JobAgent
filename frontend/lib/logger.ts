export function logError(context: string, error: unknown): void {
  console.error(`[${context}]`, error instanceof Error ? error.message : String(error));
}

export function logWarn(context: string, message: string): void {
  console.warn(`[${context}]`, message);
}
