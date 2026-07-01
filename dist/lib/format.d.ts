/**
 * Markdown to Cliq formatting converter.
 *
 * Cliq native syntax:
 *   *bold*           — single asterisk
 *   _italic_         — single underscore
 *   ~strikethrough~  — single tilde
 *   `inline code`    — backtick
 *   ```code block``` — triple backtick
 *   !blockquote      — exclamation at line start
 *   [text](url)      — links
 *
 * Ported from ~/.claude-agent/src/format.ts.
 */
export declare function markdownToCliq(text: string): string;
/** Split text into chunks at natural break points */
export declare function chunkText(text: string, limit?: number): string[];
//# sourceMappingURL=format.d.ts.map