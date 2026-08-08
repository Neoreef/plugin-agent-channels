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
export function markdownToCliq(text) {
    if (!text)
        return text;
    let result = text;
    // Protect code blocks from transformation
    const codeBlocks = [];
    result = result.replace(/```[\s\S]*?```/g, (match) => {
        codeBlocks.push(match);
        return `\x00CODE${codeBlocks.length - 1}\x00`;
    });
    // Protect inline code from transformation
    const inlineCode = [];
    result = result.replace(/`[^`]+`/g, (match) => {
        inlineCode.push(match);
        return `\x00INLINE${inlineCode.length - 1}\x00`;
    });
    // Bold: **text** → *text*
    result = result.replace(/\*\*(.+?)\*\*/g, "\x00BOLD$1\x00ENDBOLD");
    // Italic: *text* → _text_
    result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "_$1_");
    // Restore bold placeholders → *text* (Cliq bold)
    result = result.replace(/\x00BOLD(.+?)\x00ENDBOLD/g, "*$1*");
    // Strikethrough: ~~text~~ → ~text~
    result = result.replace(/~~(.+?)~~/g, "~$1~");
    // Blockquote: > text → !text
    result = result.replace(/^>\s?(.*)$/gm, "!$1");
    // Tables: strip pipe formatting
    result = result.replace(/^\|[\s\-:|]+\|$/gm, "");
    result = result.replace(/^\|(.+)\|$/gm, (_match, inner) => {
        return inner
            .split("|")
            .map((cell) => cell.trim())
            .filter((cell) => cell.length > 0)
            .join(" — ");
    });
    // Clean up blank lines left by table separator removal
    result = result.replace(/\n{3,}/g, "\n\n");
    // Restore protected content
    result = result.replace(/\x00INLINE(\d+)\x00/g, (_, i) => inlineCode[parseInt(i)]);
    result = result.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i)]);
    return result;
}
/** Split text into chunks at natural break points */
export function chunkText(text, limit = 4000) {
    if (text.length <= limit)
        return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= limit) {
            chunks.push(remaining);
            break;
        }
        let breakAt = remaining.lastIndexOf("\n\n", limit);
        if (breakAt < limit * 0.3) {
            breakAt = remaining.lastIndexOf("\n", limit);
        }
        if (breakAt < limit * 0.3) {
            breakAt = limit;
        }
        chunks.push(remaining.slice(0, breakAt));
        remaining = remaining.slice(breakAt).trimStart();
    }
    return chunks;
}
//# sourceMappingURL=format.js.map