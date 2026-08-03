export type ToolRisk = 'read' | 'write' | 'destructive' | 'network';
export type ToolSandboxMode = 'read-only' | 'workspace-write' | 'external-sandbox' | 'danger-full-access';

export interface ToolDescriptor {
  id: string;
  version: string;
  risk: ToolRisk;
  summary: string;
  supportedSandboxModes: readonly ToolSandboxMode[];
  inputSchema?: Record<string, unknown>;
}

export interface PublicToolDescriptor {
  id: string;
  version: string;
  risk: ToolRisk;
  summary: string;
  supportedSandboxModes: readonly ToolSandboxMode[];
}

export class ToolRegistry {
  private readonly descriptors = new Map<string, ToolDescriptor>();

  register(descriptor: ToolDescriptor): void {
    if (!descriptor.id || !descriptor.version || !descriptor.summary) throw new Error('tool id, version and summary are required');
    if (descriptor.supportedSandboxModes.length === 0) throw new Error('tool must declare supported sandbox modes');
    const key = this.key(descriptor.id, descriptor.version);
    if (this.descriptors.has(key)) throw new Error(`tool already registered: ${descriptor.id}@${descriptor.version}`);
    this.descriptors.set(key, { ...descriptor, supportedSandboxModes: [...descriptor.supportedSandboxModes] });
  }

  get(id: string, version: string): ToolDescriptor | undefined {
    const descriptor = this.descriptors.get(this.key(id, version));
    return descriptor ? { ...descriptor, supportedSandboxModes: [...descriptor.supportedSandboxModes] } : undefined;
  }

  list(): readonly PublicToolDescriptor[] {
    return [...this.descriptors.values()].map((descriptor) => ({
      id: descriptor.id,
      version: descriptor.version,
      risk: descriptor.risk,
      summary: descriptor.summary,
      supportedSandboxModes: [...descriptor.supportedSandboxModes],
    }));
  }

  has(id: string, version: string): boolean {
    return this.descriptors.has(this.key(id, version));
  }

  private key(id: string, version: string): string {
    return `${id}\u0000${version}`;
  }
}
