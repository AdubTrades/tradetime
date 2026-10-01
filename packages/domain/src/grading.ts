export const GRADES = ['A+', 'A', 'B+', 'B', 'C+', 'C'] as const;
export type Grade = (typeof GRADES)[number];

export interface GradeRule {
  grade: string;
  /** Highest number of missed standard criteria that still earns this grade. */
  maxMissed: number;
  /** Your own risk rule for this grade, shown as a reference (the app never sizes trades). */
  riskNote?: string | null;
}

/** Default: each missed standard criterion drops one grade, down to C. */
export const defaultGradeRules = (): GradeRule[] => GRADES.slice(0, -1).map((grade, i) => ({ grade, maxMissed: i, riskNote: null }));

export interface CriterionCheck {
  mustHave: boolean;
  checked: boolean;
}

export type GradeResult =
  | { outsidePlan: true; grade: null; missedMustHave: number; missedStandard: number }
  | { outsidePlan: false; grade: Grade; missedMustHave: 0; missedStandard: number };

/** Grade a trade from the criteria ticked before entry. Any missed must-have puts it outside the plan. */
export function gradeTrade(checks: readonly CriterionCheck[], rules: readonly GradeRule[]): GradeResult {
  const missedMustHave = checks.filter((c) => c.mustHave && !c.checked).length;
  const missedStandard = checks.filter((c) => !c.mustHave && !c.checked).length;
  if (missedMustHave > 0) return { outsidePlan: true, grade: null, missedMustHave, missedStandard };
  const rule = [...rules].sort((a, b) => GRADES.indexOf(a.grade as Grade) - GRADES.indexOf(b.grade as Grade)).find((r) => missedStandard <= r.maxMissed);
  return { outsidePlan: false, grade: (rule?.grade as Grade | undefined) ?? 'C', missedMustHave: 0, missedStandard };
}

/** Grade rules must get stricter going down: maxMissed can't decrease from A+ to C+. */
export function validateGradeRules(rules: readonly GradeRule[]): string | null {
  const ordered = GRADES.slice(0, -1).map((g) => rules.find((r) => r.grade === g));
  if (ordered.some((r) => !r)) return 'Every grade from A+ to C+ needs a rule';
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i]!.maxMissed < ordered[i - 1]!.maxMissed) return `${ordered[i]!.grade} can't allow fewer misses than ${ordered[i - 1]!.grade}`;
  }
  if (ordered.some((r) => r!.maxMissed < 0 || !Number.isInteger(r!.maxMissed))) return 'Missed counts must be whole numbers of 0 or more';
  return null;
}
