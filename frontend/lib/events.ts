// Simple in-memory pub/sub for SSE streaming to the Chrome extension.
// Events are keyed by sessionId so each extension connection only gets its own data.

type Listener = (event: ExtensionEvent) => void;

export interface ExtensionEvent {
  type: "apply_pack" | "form_fill" | "sync" | "ping" | "auto_fill_request" | "submit_approved" | "auto_apply" | "auto_apply_status";
  data: Record<string, unknown>;
}

class ExtensionEventBus {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(sessionId: string, listener: Listener): () => void {
    if (!this.listeners.has(sessionId)) {
      this.listeners.set(sessionId, new Set());
    }
    this.listeners.get(sessionId)!.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.get(sessionId)?.delete(listener);
      if (this.listeners.get(sessionId)?.size === 0) {
        this.listeners.delete(sessionId);
      }
    };
  }

  publish(sessionId: string, event: ExtensionEvent): void {
    const subs = this.listeners.get(sessionId);
    if (subs) {
      for (const listener of subs) {
        listener(event);
      }
    }
  }

  hasSubscribers(sessionId: string): boolean {
    return (this.listeners.get(sessionId)?.size ?? 0) > 0;
  }
}

// Singleton — shared across all API routes in the same process
export const extensionEvents = new ExtensionEventBus();
