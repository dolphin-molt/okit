import { describe, it, expect } from 'vitest';
import { parseCurlResponse, isRepoExistsMessage } from '../../src/commands/repo';

describe('parseCurlResponse', () => {
  it('parses response with status code', () => {
    const result = parseCurlResponse('{"id": 1}\n201');
    expect(result.body).toBe('{"id": 1}');
    expect(result.statusCode).toBe(201);
  });

  it('parses multi-line body', () => {
    const result = parseCurlResponse('line1\nline2\n200');
    expect(result.body).toBe('line1\nline2');
    expect(result.statusCode).toBe(200);
  });

  it('handles single line without status code', () => {
    const result = parseCurlResponse('just a body');
    expect(result.body).toBe('just a body');
    expect(result.statusCode).toBe(0);
  });

  it('handles empty string', () => {
    const result = parseCurlResponse('');
    expect(result.body).toBe('');
    expect(result.statusCode).toBe(0);
  });

  it('handles non-numeric status code', () => {
    const result = parseCurlResponse('body\nnot-a-number');
    expect(result.body).toBe('body');
    expect(result.statusCode).toBe(0);
  });

  it('handles null/undefined input', () => {
    const result = parseCurlResponse(null as any);
    expect(result.statusCode).toBe(0);
  });
});

describe('isRepoExistsMessage', () => {
  it('detects "already exists"', () => {
    expect(isRepoExistsMessage('Repository already exists')).toBe(true);
  });

  it('detects "name already exists"', () => {
    expect(isRepoExistsMessage('name already exists on this account')).toBe(true);
  });

  it('detects Chinese "已存在"', () => {
    expect(isRepoExistsMessage('仓库已存在')).toBe(true);
  });

  it('detects Chinese "已被占用"', () => {
    expect(isRepoExistsMessage('名称已被占用')).toBe(true);
  });

  it('detects case-insensitively', () => {
    expect(isRepoExistsMessage('REPOSITORY ALREADY EXISTS')).toBe(true);
  });

  it('returns false for unrelated messages', () => {
    expect(isRepoExistsMessage('Created successfully')).toBe(false);
    expect(isRepoExistsMessage('')).toBe(false);
  });
});
