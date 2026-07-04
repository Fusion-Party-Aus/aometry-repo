import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import info from '../info.json';

const REPO_ROOT = join(__dirname, '..');

describe('info.json', () => {
  it('has the top-level shape the Aometry host actually parses', () => {
    expect(typeof info.name).toBe('string');
    expect(info.name.length).toBeGreaterThan(0);
    expect(typeof info.version).toBe('string');
    expect(Array.isArray(info.modules)).toBe(true);
    expect(info.modules.length).toBeGreaterThan(0);
  });

  it('every module entry has a name, path, and description', () => {
    for (const mod of info.modules) {
      expect(typeof mod.name).toBe('string');
      expect(mod.name.length).toBeGreaterThan(0);
      expect(typeof mod.path).toBe('string');
      expect(mod.path.length).toBeGreaterThan(0);
      expect(typeof mod.description).toBe('string');
      expect(mod.description.length).toBeGreaterThan(0);
    }
  });

  it('every module path resolves to a real directory in this repo', () => {
    for (const mod of info.modules) {
      const resolved = join(REPO_ROOT, mod.path);
      expect(existsSync(resolved), `${mod.path} does not exist`).toBe(true);
      expect(statSync(resolved).isDirectory(), `${mod.path} is not a directory`).toBe(true);
    }
  });
});
