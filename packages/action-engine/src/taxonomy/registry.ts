import type { ActionDefinition, ActionIdentifier } from '../types';

export class ActionRegistry {
  private readonly byId = new Map<string, ActionDefinition>();

  constructor(actions: readonly ActionDefinition[]) {
    for (const action of actions) {
      if (this.byId.has(action.id)) {
        throw new Error(`Duplicate action identifier "${action.id}".`);
      }
      this.byId.set(action.id, action);
    }
  }

  get ids(): ActionIdentifier[] {
    return [...this.byId.keys()];
  }

  list(): ActionDefinition[] {
    return [...this.byId.values()];
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get(id: string): ActionDefinition | undefined {
    return this.byId.get(id);
  }
}
