// XMLike format = nested tags only, no attributes. Don't add any.
export function escapeXMLike(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
