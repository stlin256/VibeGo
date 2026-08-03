import { isAbsolute } from 'node:path';
import type { SettingsStore } from '@ready4vibe/storage';
import {
  WORKSPACE_ID_PATTERN,
  type WorkspaceRegistrationInput,
  type WorkspaceRegistryPersistence,
} from '@ready4vibe/workspaces';

export const WORKSPACE_SETTINGS_NAMESPACE = 'workspace-registry';
export const WORKSPACE_SETTINGS_KEY = 'v1';
export const WORKSPACE_SETTINGS_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_SETTINGS_MAX_ENTRIES = 128;

export interface WorkspaceSettingsPayload {
  readonly schemaVersion: typeof WORKSPACE_SETTINGS_SCHEMA_VERSION;
  readonly workspaces: readonly WorkspaceRegistrationInput[];
}

export class WorkspaceSettingsPersistenceError extends Error {
  readonly code = 'INVALID_WORKSPACE_SETTINGS';

  constructor(message = 'Workspace settings are invalid.') {
    super(message);
    this.name = 'WorkspaceSettingsPersistenceError';
  }
}

/** SQLite-backed adapter for the registry's private, non-secret snapshot. */
export class SqliteWorkspaceRegistryPersistence implements WorkspaceRegistryPersistence {
  constructor(private readonly settings: SettingsStore) {}

  load(): readonly WorkspaceRegistrationInput[] {
    const value = this.settings.get<unknown>(WORKSPACE_SETTINGS_NAMESPACE, WORKSPACE_SETTINGS_KEY);
    if (value === undefined) return [];
    return parseWorkspaceSettingsPayload(value).workspaces;
  }

  save(workspaces: readonly WorkspaceRegistrationInput[]): void {
    const payload: WorkspaceSettingsPayload = {
      schemaVersion: WORKSPACE_SETTINGS_SCHEMA_VERSION,
      workspaces: parseWorkspaceRegistrations(workspaces),
    };
    this.settings.set(WORKSPACE_SETTINGS_NAMESPACE, WORKSPACE_SETTINGS_KEY, payload);
  }
}

export function parseWorkspaceSettingsPayload(value: unknown): WorkspaceSettingsPayload {
  if (!isRecord(value) || value.schemaVersion !== WORKSPACE_SETTINGS_SCHEMA_VERSION || !Array.isArray(value.workspaces)) {
    throw new WorkspaceSettingsPersistenceError();
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'schemaVersion' || keys[1] !== 'workspaces') {
    throw new WorkspaceSettingsPersistenceError();
  }
  return {
    schemaVersion: WORKSPACE_SETTINGS_SCHEMA_VERSION,
    workspaces: parseWorkspaceRegistrations(value.workspaces),
  };
}

function parseWorkspaceRegistrations(value: readonly unknown[]): readonly WorkspaceRegistrationInput[] {
  if (!Array.isArray(value) || value.length > WORKSPACE_SETTINGS_MAX_ENTRIES) {
    throw new WorkspaceSettingsPersistenceError();
  }
  const ids = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item)) throw new WorkspaceSettingsPersistenceError();
    const itemKeys = Object.keys(item).sort();
    if (itemKeys.some((key) => key !== 'id' && key !== 'label' && key !== 'path')) {
      throw new WorkspaceSettingsPersistenceError();
    }
    if (typeof item.id !== 'string' || !WORKSPACE_ID_PATTERN.test(item.id) || item.id === 'default' || ids.has(item.id)) {
      throw new WorkspaceSettingsPersistenceError();
    }
    if (typeof item.path !== 'string' || item.path.length === 0 || item.path.length > 4_096 || /[\r\n]/u.test(item.path) || !isAbsolute(item.path)) {
      throw new WorkspaceSettingsPersistenceError();
    }
    if (item.label !== undefined && (typeof item.label !== 'string' || item.label.trim().length === 0 || item.label.length > 80 || /[\r\n]/u.test(item.label))) {
      throw new WorkspaceSettingsPersistenceError();
    }
    ids.add(item.id);
    return {
      id: item.id,
      path: item.path,
      ...(item.label === undefined ? {} : { label: item.label }),
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
