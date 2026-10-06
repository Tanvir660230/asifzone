# Sample stores (local development only)

Placeholder content for building and reviewing a store's storefront and theme before its real catalog exists.

```sh
cd apps/api
pnpm sample-store:load nasihamart --replace   # then restart the web dev server
```

- **What it loads:** store name and tagline, a clearly labelled placeholder logo, categories, products with variants, the
  homepage sections (hero, category grid, best sellers, brand story, new arrivals, promo banner, values, trust strip),
  and generated "SAMPLE IMAGE" placeholder pictures. Images go through the same upload pipeline as the admin, so each one is
  replaced in the admin like any other image.
- **Where it refuses to run:** `NODE_ENV=production`, any database that is not on this machine, and the demo mirror
  (`*_demo`). Sample content must never reach a real store.
- **`--replace`:** deactivates the categories and products the sample does not define (for example the generic seed
  catalog), and turns off hero banners. Without it, the sample is only added or updated.
- **Theme:** run the web app with `STORE_THEME=<theme>` (for example `nasihamart`) to see the sample in its theme.

Content lives in `<store>.fixture.ts`. Everything in it is invented placeholder data.
