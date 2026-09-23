/**
 * JSON for a `<script type="application/ld+json">` element.
 *
 * `JSON.stringify` does not escape `<`, `>` or `&`, and the browser ends a script element at the first `</script>` it sees,
 * whatever the JSON around it says. A product description, FAQ answer or category name containing `</script><script>…`
 * therefore closed the tag early and put the rest of the text into the page as live HTML. Escaping those characters as
 * `\uXXXX` keeps the value identical for anything that parses the JSON (search engines) while making it impossible to
 * break out of the element. U+2028/U+2029 are escaped too (they are legal in JSON but were line terminators in older JS).
 *
 * Use this for every structured-data script; never put `JSON.stringify(...)` output into `dangerouslySetInnerHTML` directly.
 */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
