import { describe, expect, it } from 'vitest';
import {
  SkillMdError,
  extraFrontmatterFromYaml,
  extraFrontmatterToYaml,
  parseAllowedTools,
  skillFromMarkdown,
  skillToMarkdown,
  splitFrontmatter,
} from './skill-md.js';
import { Skill } from './skill.js';

const full = {
  name: 'pdf-tools',
  description: 'Extract text and tables from PDFs.',
  license: 'Apache-2.0',
  compatibility: 'Needs poppler-utils installed',
  metadata: { author: 'example-org', version: '1.2' },
  allowedTools: ['Bash(pdftotext:*)', 'Read'],
  extraFrontmatter: { 'x-team': 'docs', tags: ['pdf', 'extraction'] },
  body: '# PDF tools\n\nUse pdftotext.\n',
};

describe('SKILL.md codec', () => {
  it('writes the standard key order, then other fields', () => {
    expect(skillToMarkdown(full)).toBe(
      [
        '---',
        'name: pdf-tools',
        'description: Extract text and tables from PDFs.',
        'license: Apache-2.0',
        'compatibility: Needs poppler-utils installed',
        'metadata:',
        '  author: example-org',
        '  version: "1.2"',
        'allowed-tools: Bash(pdftotext:*) Read',
        'x-team: docs',
        'tags:',
        '  - pdf',
        '  - extraction',
        '---',
        '',
        '# PDF tools',
        '',
        'Use pdftotext.',
        '',
      ].join('\n'),
    );
  });

  it('round-trips every field', () => {
    expect(skillFromMarkdown(skillToMarkdown(full))).toEqual(full);
  });

  it('omits empty optional fields', () => {
    const md = skillToMarkdown({
      name: 'a',
      description: 'b',
      metadata: {},
      allowedTools: [],
      body: '',
    });
    expect(md).toBe('---\nname: a\ndescription: b\n---\n\n');
    expect(skillFromMarkdown(md)).toEqual({ name: 'a', description: 'b', body: '' });
  });

  it('reads scalar metadata values and unquoted versions as strings', () => {
    const r = skillFromMarkdown(
      '---\nname: a\ndescription: b\nmetadata:\n  version: 1.2\n  beta: true\n---\nx',
    );
    expect(r.metadata).toEqual({ version: '1.2', beta: 'true' });
    expect(Skill.safeParse({ ...r, id: 'a-aaaaaa' }).success).toBe(true);
  });

  it('accepts allowed-tools as a YAML list too', () => {
    const r = skillFromMarkdown(
      '---\nname: a\ndescription: b\nallowed-tools:\n  - Read\n  - Grep\n---\n',
    );
    expect(r.allowedTools).toEqual(['Read', 'Grep']);
  });

  it('reports invalid YAML', () => {
    expect(() => skillFromMarkdown('---\nname: [oops\n---\n')).toThrow(SkillMdError);
  });

  it('reads hand-written files without a blank line after the frontmatter', () => {
    expect(skillFromMarkdown('---\nname: a\ndescription: b\n---\nbody').body).toBe('body');
  });

  it('does not end the frontmatter at a "---" inside a value', () => {
    const r = skillFromMarkdown('---\nname: a\ndescription: ends with ---\n---\nbody');
    expect(r.description).toBe('ends with ---');
    expect(r.body).toBe('body');
  });

  it('accepts CRLF line endings and files without frontmatter', () => {
    expect(splitFrontmatter('---\r\nname: a\r\n---\r\nbody').yaml).toBe('name: a');
    expect(splitFrontmatter('# Just markdown')).toEqual({
      yaml: undefined,
      body: '# Just markdown',
    });
  });
});

describe('allowed-tools', () => {
  it('splits on spaces outside parentheses', () => {
    expect(parseAllowedTools('Bash(git commit:*)  Read Bash(jq:*)')).toEqual([
      'Bash(git commit:*)',
      'Read',
      'Bash(jq:*)',
    ]);
  });
});

describe('other fields', () => {
  it('round-trips through YAML', () => {
    const extra = { 'x-team': 'docs', tags: ['a'] };
    expect(extraFrontmatterFromYaml(extraFrontmatterToYaml(extra))).toEqual(extra);
    expect(extraFrontmatterToYaml(undefined)).toBe('');
    expect(extraFrontmatterFromYaml('  ')).toBeUndefined();
  });

  it('rejects YAML that is not a mapping', () => {
    expect(() => extraFrontmatterFromYaml('- a\n- b')).toThrow(/key: value/);
  });

  it('may not redefine standard fields', () => {
    const r = Skill.safeParse({ ...full, id: 'a-aaaaaa', extraFrontmatter: { license: 'MIT' } });
    expect(r.success).toBe(false);
  });
});
