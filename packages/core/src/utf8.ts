/** Hard ceiling shared by every maintained Apex log ingestion boundary. */
export const MAX_LOG_BYTES = 25 * 1024 * 1024;

/**
 * Return the UTF-8 byte length of a JavaScript string without allocating an
 * encoded copy. Lone UTF-16 surrogates match TextEncoder semantics by counting
 * the replacement character U+FFFD (three bytes).
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
