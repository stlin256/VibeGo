import { basename, resolve } from 'node:path';
import { realpathSync, statSync } from 'node:fs';

export const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

export interface WorkspaceCapabilities {
  readonly filesystem: true;
  readonly externalSandbox: true;
}

export interface WorkspaceStatus {
  readonly id: string;
  readonly label: string;
  readonly isDefault: boolean;
  readonly canRemove: boolean;
  readonly capabilities: WorkspaceCapabilities;
}

export interface WorkspaceRegistryStatus {
  readonly workspaces: readonly WorkspaceStatus[];
}

export interface WorkspaceRegistrationInput {
  readonly id: string;
  readonly path: string;
  readonly label?: string;
}

export interface WorkspaceRegistry {
  status(): WorkspaceRegistryStatus;
  resolveRoot(id: string): string | undefined;
  add(input: WorkspaceRegistrationInput): WorkspaceStatus;
  remove(id: string): void;
}

/**
 * Daemon-owned persistence port. Implementations must store only the
 * non-secret registration snapshot; the registry remains the authority for
 * validation and safe status projection.
 */
export interface WorkspaceRegistryPersistence {
  load(): readonly WorkspaceRegistrationInput[];
  save(workspaces: readonly WorkspaceRegistrationInput[]): void;
}

export type WorkspaceRegistryErrorCode =
  | 'INVALID_ID'
  | 'INVALID_LABEL'
  | 'INVALID_PATH'
  | 'WORKSPACE_DUPLICATE'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_PROTECTED'
  | 'PERSISTENCE_FAILED';

export class WorkspaceRegistryError extends Error {
  constructor(readonly code: WorkspaceRegistryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WorkspaceRegistryError';
  }
}

interface WorkspaceEntry {
  readonly id: string;
  readonly label: string;
  readonly root: string;
  readonly isDefault: boolean;
}

export interface WorkspaceRegistryOptions {
  readonly defaultRoot?: string;
  readonly resolvePath?: (path: string) => string;
  readonly realpath?: (path: string) => string;
  readonly isDirectory?: (path: string) => boolean;
  readonly persistence?: WorkspaceRegistryPersistence;
}

/**
 * Small single-user registry. Roots are intentionally private: callers can
 * resolve them only to construct a guarded runtime, while status is safe to
 * send to a remote browser.
 */
export class InMemoryWorkspaceRegistry implements WorkspaceRegistry {
  private readonly entries = new Map<string, WorkspaceEntry>();
  private readonly resolvePath: (path: string) => string;
  private readonly realpath: (path: string) => string;
  private readonly isDirectory: (path: string) => boolean;
  private readonly persistence: WorkspaceRegistryPersistence | undefined;

  constructor(options: WorkspaceRegistryOptions = {}) {
    this.resolvePath = options.resolvePath ?? resolve;
    this.realpath = options.realpath ?? ((path) => realpathSync(path));
    this.isDirectory = options.isDirectory ?? ((path) => {
      try { return statSync(path).isDirectory(); } catch { return false; }
    });
    this.persistence = options.persistence;
    const root = this.normalizeDirectory(options.defaultRoot ?? process.cwd());
    this.entries.set('default', { id: 'default', label: displayLabel(root), root, isDefault: true });
    this.restorePersistedEntries();
  }

  status(): WorkspaceRegistryStatus {
    return {
      workspaces: Object.freeze([...this.entries.values()].map((entry) => this.toStatus(entry))),
    };
  }

  resolveRoot(id: string): string | undefined {
    return this.entries.get(id)?.root;
  }

  add(input: WorkspaceRegistrationInput): WorkspaceStatus {
    const entry = this.createCustomEntry(input);
    if (this.entries.has(entry.id)) throw new WorkspaceRegistryError('WORKSPACE_DUPLICATE', 'That workspace id is already registered.');
    this.entries.set(entry.id, entry);
    try {
      this.persist();
    } catch (error) {
      this.entries.delete(entry.id);
      throw error;
    }
    return this.toStatus(entry);
  }

  remove(id: string): void {
    if (id === 'default') throw new WorkspaceRegistryError('WORKSPACE_PROTECTED', 'The default workspace cannot be removed.');
    const existing = this.entries.get(id);
    if (!existing) throw new WorkspaceRegistryError('WORKSPACE_NOT_FOUND', 'Workspace was not found.');
    this.entries.delete(id);
    try {
      this.persist();
    } catch (error) {
      this.entries.set(id, existing);
      throw error;
    }
  }

  private createCustomEntry(input: WorkspaceRegistrationInput): WorkspaceEntry {
    const id = validateId(input.id);
    if (id === 'default') throw new WorkspaceRegistryError('WORKSPACE_PROTECTED', 'The default workspace cannot be removed or overwritten.');
    const root = this.normalizeDirectory(input.path);
    const label = validateLabel(input.label ?? displayLabel(root));
    return { id, label, root, isDefault: false };
  }

  private restorePersistedEntries(): void {
    if (!this.persistence) return;
    let persisted: readonly WorkspaceRegistrationInput[];
    try {
      persisted = this.persistence.load();
      if (!Array.isArray(persisted) || persisted.length > 128) throw new Error('invalid persisted workspace list');
      for (const input of persisted) {
        const entry = this.createCustomEntry(input);
        if (this.entries.has(entry.id)) throw new Error('duplicate persisted workspace id');
        this.entries.set(entry.id, entry);
      }
    } catch (error) {
      throw new WorkspaceRegistryError('PERSISTENCE_FAILED', 'Persisted workspace settings could not be restored.', { cause: error });
    }
  }

  private persist(): void {
    if (!this.persistence) return;
    const snapshot = [...this.entries.values()]
      .filter((entry) => !entry.isDefault)
      .map((entry) => ({ id: entry.id, path: entry.root, label: entry.label }));
    try {
      this.persistence.save(snapshot);
    } catch (error) {
      throw new WorkspaceRegistryError('PERSISTENCE_FAILED', 'Workspace settings could not be saved.', { cause: error });
    }
  }

  private normalizeDirectory(input: string): string {
    if (typeof input !== 'string' || input.trim().length === 0 || input.length > 4_096 || /[\r\n]/u.test(input)) {
      throw new WorkspaceRegistryError('INVALID_PATH', 'Workspace path is invalid.');
    }
    let normalized: string;
    try {
      normalized = this.realpath(this.resolvePath(input.trim()));
    } catch {
      throw new WorkspaceRegistryError('INVALID_PATH', 'Workspace path must point to an existing directory.');
    }
    if (!this.isDirectory(normalized)) throw new WorkspaceRegistryError('INVALID_PATH', 'Workspace path must point to an existing directory.');
    return normalized;
  }

  private toStatus(entry: WorkspaceEntry): WorkspaceStatus {
    return {
      id: entry.id,
      label: entry.label,
      isDefault: entry.isDefault,
      canRemove: !entry.isDefault,
      capabilities: { filesystem: true, externalSandbox: true },
    };
  }
}

function validateId(value: string): string {
  if (typeof value !== 'string' || !WORKSPACE_ID_PATTERN.test(value)) {
    throw new WorkspaceRegistryError('INVALID_ID', 'Workspace id must use lowercase letters, numbers, hyphens, or underscores.');
  }
  return value;
}

function validateLabel(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 80 || /[\r\n]/u.test(value)) {
    throw new WorkspaceRegistryError('INVALID_LABEL', 'Workspace label is invalid.');
  }
  return value.trim();
}

function displayLabel(root: string): string {
  const label = basename(root).trim();
  return label.length > 0 ? label.slice(0, 80) : 'workspace';
}
