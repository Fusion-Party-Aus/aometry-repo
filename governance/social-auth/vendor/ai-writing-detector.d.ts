/**
 * Minimal type declaration for the subset of the vendored detector's API used by
 * ../ai-writing-style.ts. See ai-writing-detector.js for the full implementation.
 */

export interface AiDetectorIssue {
  type: string;
  text: string;
  index?: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  suggestion: string | null;
}

export interface AiDetectorResult {
  score: number;
  label: string;
  issues: AiDetectorIssue[];
  stats: Record<string, unknown>;
  document_classification?: 'HUMAN_ONLY' | 'MIXED' | 'AI_ONLY' | 'UNSCORED';
  tooShort?: boolean;
  tooLong?: boolean;
}

export interface AiDetectorOptions {
  contextMode?: 'general' | 'technical' | 'marketing' | 'personal';
}

export interface AIDetector {
  analyzeText(text: string, options?: AiDetectorOptions): AiDetectorResult;
}

declare const AIDetector: AIDetector;
export default AIDetector;
