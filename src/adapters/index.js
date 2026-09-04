import { OpenCodeAdapter } from './opencode.js';
import { CursorAdapter } from './cursor.js';

class AdapterRegistry {
  constructor() {
    this.adapters = new Map();
    // 默认注册当前已知适配器
    this.register(new OpenCodeAdapter());
    this.register(new CursorAdapter());
  }

  register(adapter) {
    this.adapters.set(adapter.name, adapter);
  }

  get(name) {
    return this.adapters.get(name) || null;
  }

  listAvailable() {
    return Array.from(this.adapters.values()).filter(a => a.isAvailable());
  }

  resolveActiveContext(cwd) {
    for (const adapter of this.adapters.values()) {
      if (adapter.isAvailable()) {
        const sid = adapter.resolveActiveSessionId(cwd);
        if (sid) {
          return { sessionId: sid, sourceAgent: adapter.name };
        }
      }
    }
    return { sessionId: `ses-inferred-${Date.now().toString(36)}`, sourceAgent: 'generic' };
  }
}

export const registry = new AdapterRegistry();
export { OpenCodeAdapter, CursorAdapter };
