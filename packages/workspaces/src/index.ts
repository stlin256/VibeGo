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

export type WorkspaceRegistryErrorCode =
  | 'INVALID_ID'
  | 'INVALID_LABEL'
  | 'INVALID_PATH'
  | 'WORKSPACE_DUPLICATE'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_PROTECTED';

export class WorkspaceRegistryError extends Error {
  constructor(readonly code: WorkspaceRegistryErrorCode, message: string) {
    super(message);
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

  constructor(options: WorkspaceRegistryOptions = {}) {
    this.resolvePath = options.resolvePath ?? resolve;
    this.realpath = options.realpath ?? ((path) => realpathSync(path));
    this.isDirectory = options.isDirectory ?? ((path) => {
      try { return statSync(path).isDirectory(); } catch { return false; }
    });
    const root = this.normalizeDirectory(options.defaultRoot ?? process.cwd());
    this.entries.set('default', { id: 'default', label: displayLabel(root), root, isDefault: true });
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
    const id = validateId(input.id);
    if (this.entries.has(id)) throw new WorkspaceRegistryError('WORKSPACE_DUPLICATE', 'That workspace id is already registered.');
    const root = this.normalizeDirectory(input.path);
    const label = validateLabel(input.label ?? displayLabel(root));
    const entry: WorkspaceEntry = { id, label, root, isDefault: false };
    this.entries.set(id, entry);
    return this.toStatus(entry);
  }

  remove(id: string): void {
    if (id === 'default') throw new WorkspaceRegistryError('WORKSPACE_PROTECTED', 'The default workspace cannot be removed.');
    if (!this.entries.delete(id)) throw new WorkspaceRegistryError('WORKSPACE_NOT_FOUND', 'Workspace was not found.');
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
