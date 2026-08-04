import { describe, expect, it } from 'vitest';
import { cn } from './cn.js';
import { variantClass } from './variants.js';

describe('web class helpers', () => {
  it('composes bounded optional classes without empty tokens', () => {
    expect(cn('ui-button', false, undefined, '  ', null, 'custom')).toBe('ui-button custom');
  });

  it('selects a declared variant without accepting an unbounded map', () => {
    expect(variantClass<'ready' | 'blocked'>('ui-badge', { ready: 'ui-badge--default', blocked: 'ui-badge--destructive' }, 'ready', 'custom')).toBe('ui-badge ui-badge--default custom');
  });
});
