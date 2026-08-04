import type { JSX, ReactNode } from 'react';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/index.js';

export type SettingsSectionStatus = 'ready' | 'loading' | 'degraded' | 'unavailable' | 'idle';

export interface SettingsSectionProps {
  readonly id: string;
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: string;
  readonly status?: SettingsSectionStatus;
  readonly statusLabel?: string;
  readonly children: ReactNode;
}

const statusVariant: Record<SettingsSectionStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  ready: 'secondary',
  loading: 'outline',
  degraded: 'destructive',
  unavailable: 'destructive',
  idle: 'outline',
};

export function SettingsSection({ id, eyebrow, title, description, status, statusLabel, children }: SettingsSectionProps): JSX.Element {
  return (
    <Card className="settings-section" data-status={status ?? 'idle'} aria-labelledby={`${id}-title`}>
      <CardHeader className="settings-section-header">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <CardTitle id={`${id}-title`}>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {status && <Badge variant={statusVariant[status]} aria-live="polite">{statusLabel ?? status}</Badge>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
