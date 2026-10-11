# Cloudflare সেটআপ (asifzone.com)

Cloudflare-এ থাকলে পরের বার সার্ভার বদলানোর সময় নতুন IP সবার কাছে ১-২ সেকেন্ডেই পৌঁছায়।
কারো কম্পিউটার পুরনো IP মনে রাখে না, তাই কেউ 502 দেখে না। সাইট দ্রুত হয়, আর আসল সার্ভারের IP লুকানো
থাকে বলে আক্রমণ থেকেও সুরক্ষা পায়। ফ্রি প্ল্যানই যথেষ্ট।

## ধাপ ০ — আগে nginx আপডেট ডিপ্লয় (জরুরি)

`docker/nginx/nginx.conf`-এ Cloudflare-এর জন্য "আসল ভিজিটর IP" সেটিং যোগ করা হয়েছে। এটা ডিপ্লয় না করে
Cloudflare Proxy চালু করলে সার্ভার সব কাস্টমারকে Cloudflare-এর অল্প কয়েকটা IP হিসেবে দেখবে।
এতে এক IP থেকে কতগুলো রিকোয়েস্ট নেওয়া যাবে সেই সীমা পার হয়ে যাবে, ফলে কাস্টমাররা "429 Too Many Requests" পাবে।
fraud check, analytics আর লগেও ভুল IP যাবে।

তাই এই পরিবর্তন main-এ merge করে সার্ভারে ডিপ্লয় করুন। তারপর ধাপ ১ শুরু করবেন।

## ধাপ ১ — Cloudflare অ্যাকাউন্ট আর সাইট যোগ

1. https://dash.cloudflare.com/sign-up-এ ফ্রি অ্যাকাউন্ট খুলুন।
2. **Add a domain**-এ `asifzone.com` লিখুন। **Quick scan for DNS records** চালু রাখুন, তারপর **Free** প্ল্যান বেছে নিন।
3. Cloudflare আপনার বর্তমান DNS রেকর্ডগুলো নিজে তুলে আনবে। মিলিয়ে দেখুন:

   | Type | Name | Content | Proxy status |
   |---|---|---|---|
   | A | `asifzone.com` (`@`) | `187.77.137.12` | **Proxied** (কমলা মেঘ) |
   | A | `www` | `187.77.137.12` | **Proxied** (কমলা মেঘ) |
   | MX / TXT (ইমেইল, ভেরিফিকেশন) | যেমন আছে | যেমন আছে | **DNS only** (ধূসর মেঘ) |

   Hostinger DNS-এ যত রেকর্ড আছে, সব এখানে আছে কিনা দেখুন। বিশেষ করে ইমেইলের MX আর Google/Meta
   ভেরিফিকেশনের TXT রেকর্ড। কোনোটা বাদ পড়লে এখানে নিজে যোগ করুন।
4. **Continue** চাপলে Cloudflare দুইটা nameserver দেবে, যেমন `xxx.ns.cloudflare.com` আর `yyy.ns.cloudflare.com`।
   এগুলো কপি করে রাখুন।

## ধাপ ২ — Hostinger-এ nameserver বদল

1. Hostinger hPanel → **Domains** → `asifzone.com` → **DNS / Nameservers**।
2. **Change nameservers** → **Use custom nameservers**।
3. পুরনো nameserver মুছে Cloudflare-এর দুইটা বসান, তারপর **Save** করুন।
4. সাধারণত ১৫ মিনিট থেকে কয়েক ঘণ্টা লাগে। সক্রিয় হলে Cloudflare ইমেইল পাঠাবে, আর ড্যাশবোর্ডে **Active** দেখাবে।
   এই সময়ে সাইট বন্ধ হয় না, কারণ দুই জায়গাতেই একই IP দেওয়া আছে।

## ধাপ ৩ — Cloudflare সেটিংস (Active হওয়ার পর)

| কোথায় | সেটিং | কেন |
|---|---|---|
| SSL/TLS → Overview | **Full (strict)** | সার্ভারে আসল Let's Encrypt সার্টিফিকেট আছে। **Flexible দেবেন না।** দিলে সাইট redirect loop-এ আটকে যাবে। |
| SSL/TLS → Edge Certificates | **Always Use HTTPS: On** | |
| SSL/TLS → Edge Certificates | **Minimum TLS Version: 1.2** | |
| Speed → Optimization | Rocket Loader: **Off** | এটা Next.js আর Meta Pixel-এর স্ক্রিপ্ট ভাঙতে পারে। |
| Caching → Configuration | Caching Level: **Standard** | সার্ভারের nginx নিজেই HTML ক্যাশ নিয়ন্ত্রণ করে। |
| Security → Bots | Bot Fight Mode: **Off** | এটা চালু থাকলে Steadfast আর SSLCommerz/EPS-এর webhook আটকে যেতে পারে। |

**রাখবেন না:** "Cache Everything" ধরনের কোনো Page Rule বা Cache Rule দেবেন না।
দিলে কার্ট, অ্যাকাউন্ট আর admin পেজ অন্য কাস্টমারের কাছে চলে যেতে পারে।

## ধাপ ৪ — যাচাই

- সাইট খুলে দেখুন। ব্রাউজারের ঠিকানার পাশে তালা আইকনে ক্লিক করলে সার্টিফিকেট দেখা যাবে।
- একটা টেস্ট অর্ডার দিন। admin প্যানেলে অর্ডারটা আসছে, আর delivery score দেখাচ্ছে কিনা মিলিয়ে নিন।
- অনলাইন পেমেন্ট চালু থাকলে ছোট একটা টেস্ট পেমেন্ট করে দেখুন।

## পরের বার সার্ভার বদলাতে

`docker/zero-downtime-migrate.sh` দেখুন। Cloudflare থাকলে স্ক্রিপ্টটা DNS-ও নিজে বদলাতে পারে।
এজন্য একটা API token লাগবে:

1. Cloudflare → My Profile → **API Tokens** → **Create Token** → **Edit zone DNS** টেমপ্লেট।
   Zone Resources-এ `asifzone.com` দিন।
2. টোকেন আর ড্যাশবোর্ডের ডান পাশে থাকা **Zone ID** কপি করে রাখুন।
3. cutover-এর সময় এভাবে চালান:
   `CF_API_TOKEN=... CF_ZONE_ID=... bash zero-downtime-migrate.sh cutover`
