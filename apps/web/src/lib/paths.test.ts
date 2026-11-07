import { describe, expect, it } from 'vitest';
import { tildePath } from './paths';

describe('tildePath', () => {
  it('shows the home folder as ~', () => {
    expect(tildePath('/home/ana/code/app', '/home/ana')).toBe('~/code/app');
    expect(tildePath('/home/ana', '/home/ana/')).toBe('~');
  });
  it('leaves other paths alone', () => {
    expect(tildePath('/home/anabel/app', '/home/ana')).toBe('/home/anabel/app');
    expect(tildePath('/srv/app', '/home/ana')).toBe('/srv/app');
    expect(tildePath('/home/ana/app', undefined)).toBe('/home/ana/app');
  });
});
