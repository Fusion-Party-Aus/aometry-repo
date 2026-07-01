import { describe, it, expect } from 'vitest';
import { assessRisk, RiskAssessmentRequest } from './llm-pipeline';
import { resolveEffectiveSensitivity } from './calculator';
import { Sensitivity, PostContent, Destination } from './types';

const BASE_CONTENT: PostContent = {
  commentary: 'Fusion Party supports renewable energy transition',
  articleLink: 'https://example.com/article',
  policyLinks: ['https://www.fusionparty.org.au/climate_rescue'],
  hashtags: ['auspol', 'ClimateRescue'],
};

function makeRequest(overrides: Partial<RiskAssessmentRequest> = {}): RiskAssessmentRequest {
  return {
    content: BASE_CONTENT,
    destinations: ['Twitter/X'] as Destination[],
    submitterSensitivity: Sensitivity.LOW,
    ...overrides,
  };
}

describe('assessRisk — stub contract', () => {
  it('returns a result with all required fields', async () => {
    const result = await assessRisk(makeRequest());
    expect(result).toHaveProperty('verdict');
    expect(result).toHaveProperty('suggestedSensitivity');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('flags');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('generatedBy');
    expect(result).toHaveProperty('promptTokens');
    expect(result).toHaveProperty('outputTokens');
  });

  it('stub always returns verdict "agree"', async () => {
    const result = await assessRisk(makeRequest());
    expect(result.verdict).toBe('agree');
  });

  it('stub echoes back submitterSensitivity as suggestedSensitivity', async () => {
    for (const s of [Sensitivity.LOW, Sensitivity.MEDIUM, Sensitivity.HIGH]) {
      const result = await assessRisk(makeRequest({ submitterSensitivity: s }));
      expect(result.suggestedSensitivity).toBe(s);
    }
  });

  it('stub returns empty flags array', async () => {
    const result = await assessRisk(makeRequest());
    expect(Array.isArray(result.flags)).toBe(true);
    expect(result.flags).toHaveLength(0);
  });

  it('stub returns zero token counts', async () => {
    const result = await assessRisk(makeRequest());
    expect(result.promptTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it('stub identifies itself as "stub" generator', async () => {
    const result = await assessRisk(makeRequest());
    expect(result.generatedBy).toBe('stub');
  });

  it('summary string is non-empty', async () => {
    const result = await assessRisk(makeRequest());
    expect(result.summary.length).toBeGreaterThan(0);
  });
});

describe('assessRisk — sensitivity escalation logic (for live implementation)', () => {
  // These tests document the EXPECTED behaviour of the live LLM implementation.
  // They pass against the stub (which always agrees) but will need to be
  // updated/replaced with proper mocks once the LLM is wired up.

  it('confidence is between 0 and 1 inclusive', async () => {
    const result = await assessRisk(makeRequest());
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('verdict is one of agree | escalate | downgrade', async () => {
    const result = await assessRisk(makeRequest());
    expect(['agree', 'escalate', 'downgrade']).toContain(result.verdict);
  });

  it('suggestedSensitivity is a valid Sensitivity value', async () => {
    const result = await assessRisk(makeRequest());
    expect(Object.values(Sensitivity)).toContain(result.suggestedSensitivity);
  });

  it('each flag has required severity and reason fields', async () => {
    const result = await assessRisk(makeRequest());
    for (const flag of result.flags) {
      expect(['info', 'warning', 'critical']).toContain(flag.severity);
      expect(typeof flag.reason).toBe('string');
      expect(flag.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveEffectiveSensitivity — escalation takes precedence', () => {
  // Tests the production implementation from calculator.ts directly so regressions
  // in the real rule (AI escalation binding, downgrade advisory) are caught here.
  const { LOW, MEDIUM, HIGH } = Sensitivity;

  it('agree → uses submitter sensitivity', () => {
    expect(resolveEffectiveSensitivity(LOW, LOW, 'agree')).toBe(LOW);
    expect(resolveEffectiveSensitivity(MEDIUM, MEDIUM, 'agree')).toBe(MEDIUM);
  });

  it('escalate → uses AI suggested (higher) sensitivity', () => {
    expect(resolveEffectiveSensitivity(LOW, MEDIUM, 'escalate')).toBe(MEDIUM);
    expect(resolveEffectiveSensitivity(LOW, HIGH, 'escalate')).toBe(HIGH);
    expect(resolveEffectiveSensitivity(MEDIUM, HIGH, 'escalate')).toBe(HIGH);
  });

  it('downgrade → keeps submitter sensitivity (advisory only)', () => {
    expect(resolveEffectiveSensitivity(MEDIUM, LOW, 'downgrade')).toBe(MEDIUM);
    expect(resolveEffectiveSensitivity(HIGH, MEDIUM, 'downgrade')).toBe(HIGH);
  });

  it('escalate with same sensitivity → no change', () => {
    expect(resolveEffectiveSensitivity(HIGH, HIGH, 'escalate')).toBe(HIGH);
  });
});
