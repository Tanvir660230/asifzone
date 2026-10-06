# Sample stores (local development only)

Placeholder content for building and reviewing a store's storefront and theme before its real catalog exists.

```sh
cd apps/api
pnpm sample-store:load nasihamart --replace   # then restart the web dev server
```

- **What it loads:** store settings (name, tagline, policy, search and newsletter copy), the store's brand files from
  `docs/brand/<store>` (logo, dark-background logo, favicon, social image), categories, products with variants, the
  homepage composition defined in the fixture (`homepage`, in order), and generated "SAMPLE IMAGE" placeholder pictures.
  Every image goes through the same upload pipeline as the admin, so each one is replaced in the admin like any other.
- **Where it refuses to run:** `NODE_ENV=production`, any database that is not on this machine, and the demo mirror
  (`*_demo`). Sample content must never reach a real store.
- **`--replace`:** deactivates the categories and products the sample does not define (for example the generic seed
  catalog), and turns off hero banners. Without it, the sample is only added or updated.
- **Theme:** run the web app with `STORE_THEME=<theme>` (for example `nasihamart`) to see the sample in its theme.

Content lives in `<store>.fixture.ts`. Apart from the brand files, everything in it is invented placeholder data
(including `hello@example.com` and the sample policy) and must not be copied into a real store's settings.
