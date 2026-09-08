export const MAX_DETECTION_LINES = 100;
export const MAX_DETECTION_BYTES = 64 * 1024;

const DEBUG_LEVEL_HEADER = /(?:^|\s)APEX_CODE,[A-Z]+(?:;|$)/;
const EXECUTION_STARTED = /\|EXECUTION_STARTED(?:\||\s|$)/;
const USER_INFO = /\|USER_INFO\|/;

export interface ApexLogDetection {
  isApexLog: boolean;
  inspectedLines: number;
  inspectedBytes: number;
  marker: "debug-level-header" | "execution-started" | "user-info" | null;
}

function utf8CharacterWidth(text: string, index: number): [number, number] {
  const codeUnit = text.charCodeAt(index);
  if (codeUnit <= 0x7f) return [1, 1];
  if (codeUnit <= 0x7ff) return [2, 1];
  if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < text.length) {
    const next = text.charCodeAt(index + 1);
    if (next >= 0xdc00 && next <= 0xdfff) return [4, 2];
  }
  return [3, 1];
}

/** Inspect only a bounded prefix; contextual discovery must never parse the log. */
export function detectApexLogPrefix(text: string): ApexLogDetection {
  let inspectedBytes = 0;
  let inspectedLines = 0;
  let start = 0;

  while (inspectedLines < MAX_DETECTION_LINES && start <= text.length) {
    let end = start;
    let lineBytes = 0;
    while (end < text.length) {
      const codeUnit = text.charCodeAt(end);
      if (codeUnit === 10 || codeUnit === 13) break;
      const [characterBytes, characterCodeUnits] = utf8CharacterWidth(
        text,
        end,
      );
      if (inspectedBytes + lineBytes + characterBytes > MAX_DETECTION_BYTES) {
        return {
          isApexLog: false,
          inspectedLines,
          inspectedBytes,
          marker: null,
        };
      }
      lineBytes += characterBytes;
      end += characterCodeUnits;
    }

    const line = text.slice(start, end);
    inspectedBytes += lineBytes;
    inspectedLines += 1;

    const separatorBytes =
      end < text.length
        ? text.charCodeAt(end) === 13 && text.charCodeAt(end + 1) === 10
          ? 2
          : 1
        : 0;
    const separatorFits =
      inspectedBytes + separatorBytes <= MAX_DETECTION_BYTES;
    if (separatorFits) {
      inspectedBytes += separatorBytes;
    }

    if (DEBUG_LEVEL_HEADER.test(line)) {
      return {
        isApexLog: true,
        inspectedLines,
        inspectedBytes,
        marker: "debug-level-header",
      };
    }
    if (EXECUTION_STARTED.test(line)) {
      return {
        isApexLog: true,
        inspectedLines,
        inspectedBytes,
        marker: "execution-started",
      };
    }
    if (USER_INFO.test(line)) {
      return {
        isApexLog: true,
        inspectedLines,
        inspectedBytes,
        marker: "user-info",
      };
    }

    if (separatorBytes === 0 || !separatorFits) {
      break;
    }
    start = end + separatorBytes;
  }

  return { isApexLog: false, inspectedLines, inspectedBytes, marker: null };
}

export function hasLogSuffix(path: string): boolean {
  return String(path).toLowerCase().endsWith(".log");
}
