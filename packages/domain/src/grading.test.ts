import { describe, expect, it } from 'vitest';
import { defaultGradeRules, gradeTrade, validateGradeRules } from './grading';

const checks = (mustHave: boolean[], standard: boolean[]) => [
  ...mustHave.map((checked) => ({ mustHave: true, checked })),
  ...standard.map((checked) => ({ mustHave: false, checked })),
];

describe('gradeTrade', () => {
  const rules = defaultGradeRules();

  it('gives A+ when everything is ticked', () => {
    expect(gradeTrade(checks([true], [true, true, true]), rules)).toMatchObject({ outsidePlan: false, grade: 'A+' });
  });

  it('drops one grade per missed standard criterion, bottoming out at C', () => {
    expect(gradeTrade(checks([true], [false, true, true]), rules).grade).toBe('A');
    expect(gradeTrade(checks([true], [false, false, true]), rules).grade).toBe('B+');
    expect(gradeTrade(checks([], Array(5).fill(false)), rules).grade).toBe('C');
    expect(gradeTrade(checks([], Array(9).fill(false)), rules).grade).toBe('C');
  });

  it('flags a missed must-have as outside the plan', () => {
    expect(gradeTrade(checks([false, true], [true]), rules)).toEqual({ outsidePlan: true, grade: null, missedMustHave: 1, missedStandard: 0 });
  });

  it('uses per-Play rules', () => {
    // A Play with few criteria: one miss is still A, two is B.
    const lenient = [
      { grade: 'A+', maxMissed: 0 },
      { grade: 'A', maxMissed: 1 },
      { grade: 'B+', maxMissed: 1 },
      { grade: 'B', maxMissed: 2 },
      { grade: 'C+', maxMissed: 2 },
    ];
    expect(gradeTrade(checks([], [false, false, true]), lenient).grade).toBe('B');
    expect(validateGradeRules(lenient)).toBeNull();
  });

  it('a Play with no criteria grades A+', () => {
    expect(gradeTrade([], rules).grade).toBe('A+');
  });

  it('validates rule ordering', () => {
    const bad = defaultGradeRules();
    bad[2]!.maxMissed = 0;
    expect(validateGradeRules(bad)).toMatch(/B\+ can't allow fewer/);
  });
});
