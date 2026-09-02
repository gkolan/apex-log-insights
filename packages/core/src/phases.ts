/**
 * How confidently an event, phase, or issue maps to the raw debug log.
 *
 * - `'direct'`   — a specific log event explicitly proves this.
 * - `'derived'`  — inferred from a combination of related log events.
 * - `'inferred'` — assumed based on transaction context with no direct evidence.
 */
export type EvidenceConfidence = "direct" | "derived" | "inferred";

/**
 * Identifies one of the 20+ Salesforce Order of Execution phases.
 * Phase IDs are stable strings suitable for use as keys or CSS anchors.
 *
 * @see {@link EXECUTION_PHASE_DEFINITIONS} for the full ordered list.
 * @see https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_order_of_execution.htm
 */
export type ExecutionPhaseId =
  | "phase-01-load-original-record"
  | "phase-02-system-validation"
  | "phase-03-before-triggers"
  | "phase-04-before-save-flows"
  | "phase-05-validation-rules"
  | "phase-06-duplicate-rules"
  | "phase-07-save-to-database"
  | "phase-08-after-triggers"
  | "phase-09-assignment-rules"
  | "phase-10-auto-response-rules"
  | "phase-11-workflow-rules"
  | "phase-12-escalation-rules"
  | "phase-13-process-builder"
  | "phase-14-after-save-flows"
  | "phase-15-entitlement-rules"
  | "phase-16-rollup-summary"
  | "phase-17-criteria-evaluation"
  | "phase-17a-process-builder"
  | "phase-17b-workflow-criteria"
  | "phase-18-sharing-rules"
  | "phase-19-dml-commit"
  | "phase-20-post-commit-logic";

/**
 * Static metadata for a single Salesforce Order of Execution phase.
 * Used to map parsed log events into the standard 20-phase lifecycle.
 */
export interface PhaseDefinition {
  /** Stable identifier for this phase (e.g. `'phase-03-before-triggers'`). */
  id: ExecutionPhaseId;

  /** 1-based ordinal position in the Order of Execution. */
  index: number;

  /** Human-readable phase name (e.g. `'Before Triggers'`). */
  name: string;

  /** Relative path to the synthetic documentation file for this phase. */
  syntheticDoc: string;

  /** Default confidence level when evidence is not explicitly provided. */
  defaultConfidence: EvidenceConfidence;
}

/**
 * Complete ordered list of Salesforce Order of Execution phase definitions.
 *
 * This array mirrors the official Salesforce documentation and covers all
 * 20 phases from "Load Original Record" through "Post-Commit Logic",
 * including sub-phases 17a (Process Builder) and 17b (Workflow Criteria).
 *
 * @see https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_order_of_execution.htm
 */
export const EXECUTION_PHASE_DEFINITIONS: PhaseDefinition[] = [
  {
    id: "phase-01-load-original-record",
    index: 1,
    name: "Load Original Record",
    syntheticDoc: "docs/synthetic_logs/phase-01-load-original-record.md",
    defaultConfidence: "inferred",
  },
  {
    id: "phase-02-system-validation",
    index: 2,
    name: "System Validation",
    syntheticDoc: "docs/synthetic_logs/phase-02a-system-validation-ui.md",
    defaultConfidence: "derived",
  },
  {
    id: "phase-03-before-triggers",
    index: 3,
    name: "Before Triggers",
    syntheticDoc: "docs/synthetic_logs/phase-03-before-triggers.md",
    defaultConfidence: "direct",
  },
  {
    id: "phase-04-before-save-flows",
    index: 4,
    name: "Before-Save Flows",
    syntheticDoc: "docs/synthetic_logs/phase-04-before-save-flows.md",
    defaultConfidence: "direct",
  },
  {
    id: "phase-05-validation-rules",
    index: 5,
    name: "Validation Rules",
    syntheticDoc: "docs/synthetic_logs/phase-05-validation-rules.md",
    defaultConfidence: "direct",
  },
  {
    id: "phase-06-duplicate-rules",
    index: 6,
    name: "Duplicate Rules",
    syntheticDoc: "docs/synthetic_logs/phase-06-07-duplicate-rules-and-save.md",
    defaultConfidence: "derived",
  },
  {
    id: "phase-07-save-to-database",
    index: 7,
    name: "Save To Database",
    syntheticDoc: "docs/synthetic_logs/phase-06-07-duplicate-rules-and-save.md",
    defaultConfidence: "derived",
  },
  {
    id: "phase-08-after-triggers",
    index: 8,
    name: "After Triggers",
    syntheticDoc: "docs/synthetic_logs/phase-08-after-triggers.md",
    defaultConfidence: "direct",
  },
  {
    id: "phase-09-assignment-rules",
    index: 9,
    name: "Assignment Rules",
    syntheticDoc: "docs/synthetic_logs/phase-09-10-assignment-auto-response.md",
    defaultConfidence: "derived",
  },
  {
    id: "phase-10-auto-response-rules",
    index: 10,
    name: "Auto-Response Rules",
    syntheticDoc: "docs/synthetic_logs/phase-09-10-assignment-auto-response.md",
    defaultConfidence: "derived",
  },
  {
    id: "phase-11-workflow-rules",
    index: 11,
    name: "Workflow Rules",
    syntheticDoc: "docs/synthetic_logs/phase-11-11a-workflow-rules.md",
    defaultConfidence: "direct",
  },
  {
    id: "phase-12-escalation-rules",
    index: 12,
    name: "Escalation Rules",
    syntheticDoc:
      "docs/synthetic_logs/phase-12-13-escalation-process-builder.md",
    defaultConfidence: "derived",
  },
  {
    id: "phase-13-process-builder",
    index: 13,
    name: "Process Builder",
    syntheticDoc:
      "docs/synthetic_logs/phase-12-13-escalation-process-builder.md",
    defaultConfidence: "derived",
  },
  {
    id: "phase-14-after-save-flows",
    index: 14,
    name: "After-Save Flows",
    syntheticDoc: "docs/synthetic_logs/phase-14-after-save-flows.md",
    defaultConfidence: "direct",
  },
  {
    id: "phase-15-entitlement-rules",
    index: 15,
    name: "Entitlement Rules",
    syntheticDoc: "docs/synthetic_logs/phase-15-16-17-entitlement-rollup.md",
    defaultConfidence: "derived",
  },
  {
    id: "phase-16-rollup-summary",
    index: 16,
    name: "Rollup Summary",
    syntheticDoc: "docs/synthetic_logs/phase-15-16-17-entitlement-rollup.md",
    defaultConfidence: "derived",
  },
  {
    id: "phase-17-criteria-evaluation",
    index: 17,
    name: "Criteria Evaluation",
    syntheticDoc: "docs/synthetic_logs/phase-15-16-17-entitlement-rollup.md",
    defaultConfidence: "derived",
  },
  {
    id: "phase-17a-process-builder",
    index: 17,
    name: "Process Builder",
    syntheticDoc:
      "docs/synthetic_logs/phase-12-13-escalation-process-builder.md",
    defaultConfidence: "direct",
  },
  {
    id: "phase-17b-workflow-criteria",
    index: 17,
    name: "Workflow Criteria",
    syntheticDoc: "docs/synthetic_logs/phase-11-11a-workflow-rules.md",
    defaultConfidence: "direct",
  },
  {
    id: "phase-18-sharing-rules",
    index: 18,
    name: "Sharing Rules",
    syntheticDoc:
      "docs/synthetic_logs/phase-18-criteria-based-sharing-rules.md",
    defaultConfidence: "derived",
  },
  {
    id: "phase-19-dml-commit",
    index: 19,
    name: "DML Commit",
    syntheticDoc: "docs/synthetic_logs/phase-19-dml-commit.md",
    defaultConfidence: "direct",
  },
  {
    id: "phase-20-post-commit-logic",
    index: 20,
    name: "Post-Commit Logic",
    syntheticDoc: "docs/synthetic_logs/phase-20-post-commit-logic.md",
    defaultConfidence: "derived",
  },
];
