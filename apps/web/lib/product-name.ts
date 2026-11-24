/**
 * A product name as "style – colour" ("Haven Sleeveless Jacket – Light Ash"), split so a card can lead with what differs
 * between neighbours (the colour). The separator is a dash with spaces around it — en dash, em dash or hyphen — and the
 * last one counts; a hyphen inside a word ("Full-Sleeve") is not a separator. Without a usable split the name stays whole.
 */
export function splitStyleColour(name: string): { style: string; colour: string | null } {
  const trimmed = name.trim();
  const separators = [...trimmed.matchAll(/\s+[–—-]\s+/g)];
  const last = separators.at(-1);
  if (!last || last.index === undefined) return { style: trimmed, colour: null };
  const style = trimmed.slice(0, last.index).trim();
  const colour = trimmed.slice(last.index + last[0].length).trim();
  if (!style || !colour) return { style: trimmed, colour: null };
  return { style, colour };
}
