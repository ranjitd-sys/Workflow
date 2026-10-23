export interface StructuredGenerationRequest {
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: unknown;
  signal?: AbortSignal;
}

/**
 * Boundary between the chat intent engine and any concrete LLM provider.
 * Implementations return already-parsed JSON; the engine validates it.
 */
export interface StructuredLlmProvider {
  generateStructured(request: StructuredGenerationRequest): Promise<unknown>;
}
