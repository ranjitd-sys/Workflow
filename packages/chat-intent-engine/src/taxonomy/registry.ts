import type { IntentDefinition, IntentId } from '../types';

/**
 * Immutable registry of the intent categories the model is allowed to choose.
 */
export class IntentRegistry {
  private readonly byId = new Map<IntentId, IntentDefinition>();

  constructor(intents: readonly IntentDefinition[]) {
    for (const intent of intents) {
      if (this.byId.has(intent.id)) {
        throw new Error(`Duplicate intent id "${intent.id}".`);
      }
      this.byId.set(intent.id, intent);
    }
  }

  get ids(): IntentId[] {
    return [...this.byId.keys()];
  }

  list(): IntentDefinition[] {
    return [...this.byId.values()];
  }

  has(id: string): boolean {
    return this.byId.has(id as IntentId);
  }
}
