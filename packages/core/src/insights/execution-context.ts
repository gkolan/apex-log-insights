// Execution context detection and overrides.
//
// Identifies whether the execution was triggered by an anonymous apex execution,
// a trigger, a batch job, scheduled apex, future method, queueable, platform event,
// or plain Apex class. Maps those contexts to appropriate phase models.

import type {
  FlatEvent,
  ExecutionContextDetection,
  ExecutionContextType,
  PhaseModelId,
  ParsedVariableAssignment,
} from './types.js';

/**
 * Auto-detects execution context (anonymous apex, trigger, scheduled, batch, future, queueable, etc.) from root code unit, events, and variable assignments.
 *
 * Analyzes the root code unit name, parses events for context markers (FUTURE_METHOD_BEGIN, BATCH_APEX_START_BEGIN, etc.),
 * and inspects variable assignments to infer the execution context type. Returns a detection result with confidence level and signals.
 *
 * @param rootCodeUnit - The root code unit name from the log, or null if unavailable
 * @param allEvents - Array of all parsed events from the log
 * @param variableAssignments - Array of parsed variable assignments
 * @returns ExecutionContextDetection with detected type, confidence, signals, and phase model
 */
export function detectExecutionContext(
  rootCodeUnit: string | null,
  allEvents: FlatEvent[],
  variableAssignments: ParsedVariableAssignment[],
): ExecutionContextDetection {
  const root = String(rootCodeUnit || '').toLowerCase();

  // Anonymous Apex — most distinctive, check first
  if (
    /execute_anonymous_apex|execute anonymous/i.test(root) ||
    allEvents.some((e) => e.type === 'CODE_UNIT_STARTED' && /execute_anonymous_apex|execute anonymous/i.test(e.text || ''))
  ) {
    return {
      type: 'anonymous_apex',
      label: 'Anonymous Apex',
      confidence: 'direct',
      signals: ['CODE_UNIT_STARTED text contains execute anonymous'],
      contextSource: 'auto',
      phaseModel: 'anonymous',
    };
  }

  // Future method
  if (allEvents.some((e) => e.type === 'FUTURE_METHOD_BEGIN')) {
    return {
      type: 'future_method',
      label: 'Future Method',
      confidence: 'direct',
      signals: ['FUTURE_METHOD_BEGIN event found'],
      contextSource: 'auto',
      phaseModel: 'async',
    };
  }

  // Queueable
  if (
    allEvents.some((e) => e.type === 'QUEUEABLE_BEGIN')
    || allEvents.some((e) => e.type === 'SYSTEM_METHOD_ENTRY' && /QueueableContextImpl/i.test(e.text || ''))
  ) {
    return {
      type: 'queueable',
      label: 'Queueable Apex',
      confidence: 'direct',
      signals: ['QUEUEABLE_BEGIN event found or SYSTEM_METHOD_ENTRY with QueueableContextImpl'],
      contextSource: 'auto',
      phaseModel: 'async',
    };
  }

  // Scheduled Apex
  if (
    root.includes('schedulable') ||
    root.includes('scheduledapex') ||
    allEvents.some(
      (e) => e.type === 'CODE_UNIT_STARTED' && /schedulable|scheduled apex/i.test(e.text || ''),
    )
  ) {
    return {
      type: 'scheduled',
      label: 'Scheduled Apex',
      confidence: 'derived',
      signals: ['rootCodeUnit or CODE_UNIT_STARTED contains Schedulable/Scheduled'],
      contextSource: 'auto',
      phaseModel: 'scheduled',
    };
  }

  // Batch Apex — check events first, then heuristics
  if (allEvents.some((e) => e.type === 'BATCH_APEX_START_BEGIN' || e.type === 'BATCH_APEX_EXECUTE_BEGIN')) {
    return {
      type: 'batch_execute',
      label: 'Batch Apex',
      confidence: 'direct',
      signals: ['BATCH_APEX_START_BEGIN or BATCH_APEX_EXECUTE_BEGIN event found'],
      contextSource: 'auto',
      phaseModel: 'batch',
    };
  }
  if (
    variableAssignments.some((v) => v.variableName === 'scope' && (Array.isArray(v.parsedValue) || (typeof v.parsedValue === 'object' && v.parsedValue !== null))) ||
    root.includes('batch') ||
    root.includes('batchable')
  ) {
    return {
      type: 'batch_execute',
      label: 'Batch Apex',
      confidence: 'derived',
      signals: ['scope variable assignment or batch in root code unit name'],
      contextSource: 'auto',
      phaseModel: 'batch',
    };
  }

  // Platform Event
  // Salesforce logs do not emit a canonical PLATFORM_EVENT event type.
  // Detect from actual code-unit text patterns and common event-bus markers.
  if (
    allEvents.some(
      (e) =>
        (e.type === 'CODE_UNIT_STARTED' && /platform event|__e\b/i.test(e.text || ''))
        || (e.type.startsWith('EVENT_SERVICE_') && /__e\b|platform event/i.test(e.text || '')),
    )
  ) {
    return {
      type: 'platform_event',
      label: 'Platform Event',
      confidence: 'direct',
      signals: ['CODE_UNIT_STARTED/EVENT_SERVICE_* indicates platform event context'],
      contextSource: 'auto',
      phaseModel: 'trigger',
    };
  }

  // Synchronous trigger
  if (
    root.includes('trigger') ||
    allEvents.some((e) => e.type === 'CODE_UNIT_STARTED' && /trigger event/i.test(e.text || ''))
  ) {
    return {
      type: 'synchronous_trigger',
      label: 'Trigger',
      confidence: 'direct',
      signals: ['rootCodeUnit or CODE_UNIT_STARTED contains trigger event'],
      contextSource: 'auto',
      phaseModel: 'trigger',
    };
  }

  return {
    type: 'apex_class',
    label: 'Apex Class',
    confidence: 'derived',
    signals: ['no specific context signals found, defaulting to Apex Class'],
    contextSource: 'auto',
    phaseModel: 'trigger',
  };
}

// Maps a CLI --context value to its display label.
const CONTEXT_TYPE_LABELS: Record<string, string> = {
  anonymous_apex: 'Anonymous Apex',
  queueable: 'Queueable Apex',
  future_method: 'Future Method',
  batch_execute: 'Batch Apex',
  scheduled: 'Scheduled Apex',
  platform_event: 'Platform Event',
  synchronous_trigger: 'Trigger',
  apex_class: 'Apex Class',
};

// Maps execution context type to the appropriate phase model.
const CONTEXT_TO_PHASE_MODEL: Record<string, PhaseModelId> = {
  anonymous_apex: 'anonymous',
  future_method: 'async',
  queueable: 'async',
  scheduled: 'scheduled',
  batch_execute: 'batch',
  platform_event: 'trigger',
  synchronous_trigger: 'trigger',
  apex_class: 'trigger',
  unknown: 'trigger',
};

/**
 * Validates and builds an execution context detection from a user-provided override string.
 *
 * Maps the provided context value to a valid ExecutionContextType and builds a detection result with confidence
 * marked as 'override'. Returns null if the value is not a recognized execution context type.
 *
 * @param contextValue - The context override value (e.g., 'anonymous_apex', 'batch_execute', 'synchronous_trigger')
 * @returns ExecutionContextDetection if the value is valid, null otherwise
 */
export function buildContextOverride(contextValue: string): ExecutionContextDetection | null {
  const label = CONTEXT_TYPE_LABELS[contextValue];
  if (!label) return null;
  return {
    type: contextValue as ExecutionContextType,
    label,
    confidence: 'override',
    signals: [`--context flag: ${contextValue}`],
    contextSource: 'override',
    phaseModel: CONTEXT_TO_PHASE_MODEL[contextValue] ?? 'trigger',
  };
}

// The set of valid values for the --context CLI flag.
export const VALID_CONTEXT_VALUES = Object.keys(CONTEXT_TYPE_LABELS);
