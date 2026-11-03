import { describe, expect, it } from 'vitest';
import { readSkillMd, writeSkillMd } from './layout.js';

describe('SKILL.md frontmatter', () => {
  it('round-trips frontmatter and body', () => {
    const text = writeSkillMd({ name: 'a', description: 'b: with colon' }, '# Title\n\nbody\n');
    expect(readSkillMd(text)).toEqual({
      frontmatter: { name: 'a', description: 'b: with colon' },
      body: '# Title\n\nbody\n',
    });
  });

  it('round-trips an empty body', () => {
    expect(readSkillMd(writeSkillMd({ name: 'a', description: 'b' }, '')).body).toBe('');
  });

  it('reads hand-written files without a blank line after the frontmatter', () => {
    expect(readSkillMd('---\nname: a\ndescription: b\n---\nbody')).toEqual({
      frontmatter: { name: 'a', description: 'b' },
      body: 'body',
    });
  });

  it('does not end the frontmatter at a "---" inside a value', () => {
    const r = readSkillMd('---\nname: a\ndescription: ends with ---\n---\nbody');
    expect(r.frontmatter.description).toBe('ends with ---');
    expect(r.body).toBe('body');
  });

  it('accepts CRLF line endings', () => {
    expect(readSkillMd('---\r\nname: a\r\n---\r\nbody').frontmatter).toEqual({ name: 'a' });
  });

  it('treats files without frontmatter as body only', () => {
    expect(readSkillMd('# Just markdown')).toEqual({ frontmatter: {}, body: '# Just markdown' });
  });
});
