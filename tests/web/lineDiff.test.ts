import { describe, it, expect } from 'vitest';
import { diffLines, toSideBySide } from '../../src/web/frontend/src/lib/lineDiff';

const A = ['{', '  "a": 1,', '  "old": 2,', '  "c": 3', '}'].join('\n');
const B = ['{', '  "a": 1,', '  "new": 2,', '  "extra": 9,', '  "c": 3', '}'].join('\n');

describe('diffLines', () => {
  it('counts additions and deletions across a replaced block', () => {
    const d = diffLines(A, B);
    expect(d.adds).toBe(2);
    expect(d.dels).toBe(1);
    expect(d.hunks.length).toBe(1);
  });

  it('reports zero changes for identical input', () => {
    const d = diffLines(A, A);
    expect(d.adds).toBe(0);
    expect(d.dels).toBe(0);
    expect(d.hunks.length).toBe(0);
  });
});

describe('toSideBySide', () => {
  it('pairs deleted and added lines row by row, padding the shorter side', () => {
    const d = diffLines(A, B);
    const rows = toSideBySide(d.hunks[0]);
    expect(rows[0].kind).toBe('hunk');

    const changeRows = rows.filter(r => r.kind === 'row' && (r.left?.op === 'del' || r.right?.op === 'add')) as Extract<typeof rows[number], { kind: 'row' }>[];
    // del=1, add=2 → two paired rows; row 1 compares old vs new, row 2 has no left side
    expect(changeRows).toHaveLength(2);
    expect(changeRows[0].left?.op).toBe('del');
    expect(changeRows[0].right?.op).toBe('add');
    expect(changeRows[1].left).toBeNull();
    expect(changeRows[1].right?.op).toBe('add');
  });

  it('emits a hunk header with real line counts', () => {
    const d = diffLines(A, B);
    const [hdr] = toSideBySide(d.hunks[0]);
    // context 3 + 1 del on the snapshot side; context 3 + 2 adds on the current side
    expect(hdr).toMatchObject({ kind: 'hunk', header: '@@ -1,5 +1,6 @@' });
  });

  it('duplicates context lines on both sides with their own line numbers', () => {
    const d = diffLines(A, B);
    const rows = toSideBySide(d.hunks[0]);
    const ctx = rows.find(r => r.kind === 'row' && r.left?.text === '  "a": 1,');
    expect(ctx).toMatchObject({
      kind: 'row',
      left: { num: 2, op: 'ctx', text: '  "a": 1,' },
      right: { num: 2, op: 'ctx', text: '  "a": 1,' },
    });
  });
});
