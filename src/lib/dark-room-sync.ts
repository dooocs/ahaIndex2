export type GameState = Record<string, unknown>;
export type SaveOperation = 'autosave' | 'manual' | 'import' | 'reset' | 'conflict';
export interface CloudSave {
  state: GameState;
  revision: number;
  schema_version: number;
  game_version: string;
  updated_at: string;
  last_request_id: string;
  last_operation: string;
}
export interface SaveSlot {
  revision: number;
  saved_at: string;
  reason: string;
  is_manual_slot: boolean;
}
export interface SaveRequest {
  request_id: string;
  device_id: string;
  operation: SaveOperation;
  state: GameState;
  expected_revision?: number;
}
interface LocalRecord {
  revision: number;
  synced: string;
  pending: SaveRequest[];
  guestChoice: boolean;
}
export const guestKey = 'amazingindex.dark-room.gameState';
export const accountKey = (owner: string) => `amazingindex.dark-room.user.${owner}.gameState`;

export function parseState(raw: string | null): GameState | null {
  try {
    const state = JSON.parse(raw || 'null');
    if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
    if (state.version !== undefined && ![1, 1.1, 1.2, 1.3].includes(state.version)) return null;
    return state;
  } catch { return null; }
}

// JSONB returns object keys in a different order from the engine's JSON.
export function canonicalState(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

export class DarkRoomSync {
  readonly key: string;
  readonly owner: string;
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
  readonly device: string;
  record: LocalRecord;
  constructor(owner: string, storage: Pick<Storage, 'getItem' | 'setItem'>, device: string) {
    this.owner = owner;
    this.storage = storage;
    this.device = device;
    this.key = accountKey(owner);
    const raw = storage.getItem(`${this.key}.sync`);
    this.record = raw ? JSON.parse(raw) : { revision: 0, synced: '', pending: [], guestChoice: false };
    if (!Number.isSafeInteger(this.record.revision) || !Array.isArray(this.record.pending)) throw new Error('invalid_local_save');
  }

  persist() { this.storage.setItem(`${this.key}.sync`, JSON.stringify(this.record)); }

  capture(state: GameState, operation: SaveOperation = 'autosave') {
    const snapshot = JSON.parse(JSON.stringify(state)) as GameState;
    this.storage.setItem(this.key, JSON.stringify(snapshot));
    const last = this.record.pending.at(-1);
    if (operation === 'autosave') {
      if (canonicalState(snapshot) === (last ? canonicalState(last.state) : this.record.synced)) return;
      // Never alter a request that may already have committed remotely.
      if (last?.operation === 'autosave' && last.expected_revision === undefined) this.record.pending.pop();
    }
    this.record.pending.push({ request_id: crypto.randomUUID(), device_id: this.device, operation, state: snapshot });
    this.persist();
  }

  next() {
    const request = this.record.pending[0];
    if (request && request.expected_revision === undefined) {
      request.expected_revision = this.record.revision;
      this.persist();
    }
    return request;
  }

  acknowledge(save: CloudSave) {
    if (this.record.pending[0]?.request_id !== save.last_request_id) throw new Error('invalid_acknowledgement');
    this.record.pending.shift();
    this.record.revision = save.revision;
    this.record.synced = canonicalState(save.state);
    this.persist();
  }

  rebase(save: CloudSave | null) {
    this.record.revision = save?.revision || 0;
    this.record.synced = save ? canonicalState(save.state) : '';
    for (const request of this.record.pending) delete request.expected_revision;
    this.persist();
  }

  archive(state: GameState) {
    this.storage.setItem(`${this.key}.recovery`, JSON.stringify({ state, record: this.record, saved_at: new Date().toISOString() }));
  }

  useCloud(save: CloudSave) {
    if (save.schema_version !== 1 || !parseState(JSON.stringify(save.state))) throw new Error('unsupported_save');
    this.record.pending = [];
    this.rebase(save);
    this.storage.setItem(this.key, JSON.stringify(save.state));
  }
}
