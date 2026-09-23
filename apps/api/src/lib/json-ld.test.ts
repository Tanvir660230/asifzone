import { describe, it, expect } from "vitest";
import { jsonLdString } from "@clothing-brand/shared";

describe("jsonLdString", () => {
  it("cannot be broken out of a script element, whatever the text says", () => {
    const evil = {
      description: "</script><script>window.__xss = 1</script><img src=x onerror=alert(1)>",
      text: "a & b < c > d",
      nested: [{ name: "<!-- x -->" }],
    };
    const out = jsonLdString(evil);
    // Nothing the HTML parser treats specially survives in the output…
    expect(out).not.toMatch(/[<>&]/);
    expect(out.toLowerCase()).not.toContain("</script");
    // …and it is still the same JSON to anything that parses it (search engines).
    expect(JSON.parse(out)).toEqual(evil);
  });

  it("escapes the line-separator characters that older JavaScript treated as line ends", () => {
    const value = { note: "before" + String.fromCharCode(0x2028) + "middle" + String.fromCharCode(0x2029) + "after" };
    const out = jsonLdString(value);
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
    expect(out).not.toContain(String.fromCharCode(0x2028));
    expect(JSON.parse(out)).toEqual(value);
  });

  it("leaves ordinary structured data unchanged", () => {
    const plain = { "@context": "https://schema.org", "@type": "Product", name: "Panjabi", offers: { price: 1200 } };
    expect(jsonLdString(plain)).toBe(JSON.stringify(plain));
  });
});
