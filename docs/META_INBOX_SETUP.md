# Social Inbox — Meta setup (WhatsApp, Messenger, Instagram, comments)

For the store owner. Do these once per store (Asif Zone first, then Nasihamart with its own Page, number and keys).
Everything you paste goes into **Store Console › Settings › Integrations › Customer messages**.

Approval at Meta takes days. Start steps 1–2 today; the Inbox works with whatever is connected so far.

## 1. Business verification (start today)
business.facebook.com › Settings › Business info › **Start verification**. Upload the trade licence (or another business
document) with the same business name and address. Meta replies in 1–5 working days.

## 2. Create the Meta app
1. developers.facebook.com › My apps › **Create app** › type **Business**, owned by your business portfolio.
2. Add the products **Messenger**, **Instagram** and **WhatsApp**, and **Webhooks**.
3. App settings › Basic: copy the **App secret** → Settings › Integrations › *Meta app (webhook)* › App secret.
4. In the same card press **Generate verify token**, then **Save**.

## 3. Webhook
In the Meta app › Webhooks (and WhatsApp › Configuration), paste the **Callback URL** and **Verify token** shown in the
*Meta app (webhook)* card, then subscribe:
- Page: `messages`, `message_echoes`, `feed`
- Instagram: `messages`
- WhatsApp Business Account: `messages`, `smb_message_echoes`

## 4. Facebook Page and Instagram
1. Business settings › Users › **System users** › add one (Admin) › assign the Page (and the Instagram account) with full control.
2. **Generate token** for the app with: `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`,
   `pages_manage_engagement`, `pages_show_list`, `instagram_basic`, `instagram_manage_messages`, `business_management`.
   Choose **Never expire**.
3. Paste into *Facebook & Instagram messages*: Page ID, that token, and the Instagram account ID (Instagram is optional).

## 5. App Review (so real customers' messages arrive, not just yours)
App Review › request **Advanced access** for the permissions above, plus the **Human Agent** feature (lets staff reply
on Messenger/Instagram up to 7 days). Meta asks for a short screen recording: open the Inbox, show a message arriving
and a reply going out. Until approved, only people with a role on the app can test.

## 6. WhatsApp on your current number (coexistence)
Your number stays on the WhatsApp Business app on the phone **and** comes into the Inbox. Meta allows this only through
its **Embedded Signup** flow, run by an app that is a **Tech Provider**:
1. In the Meta app › WhatsApp › get started as a **Tech Provider** (no extra verification since Oct 2025).
2. WhatsApp › Embedded Signup › create a configuration (Cloud API, coexistence on) → note its **Configuration ID**.
3. **Tell Claude the Configuration ID** — the store then gets a *Connect WhatsApp* button that runs Meta's signup on
   your phone (scan, confirm, chat history syncs), and fills in the phone number ID and token itself. This last piece
   is built once the configuration exists, because it can only be tested against your real app.

Needs WhatsApp Business app **2.24.17 or newer** on the phone. While both are in use the number sends up to 20 messages
a second — far above a shop's needs.

*If you prefer a separate new number instead:* WhatsApp › API Setup › add the number, then paste its **Phone number
ID** and a system-user token (permissions `whatsapp_business_messaging`, `whatsapp_business_management`) into the
*WhatsApp* card. No Embedded Signup needed.

## 7. Turn on the AI
1. The *Claude (Anthropic)* card under AI assistant must have an API key.
2. *AI replies* starts on **Drafts only**: every message gets a suggested reply in the Inbox; staff check and send it.
3. After a few days of good drafts, switch it to **Auto-send price, stock, delivery and order-status answers**.

What the AI never does on its own: complaints, returns, exchanges, payment problems, anything about a photo or voice
note, anything it couldn't look up, a chat where staff answered in the last 12 hours, more than 3 answers per chat per
day, or a Messenger/Instagram reply after 24 hours. Order status needs the WhatsApp sender's own number, or the order
number together with the order's phone.

## Rules Meta enforces (the Inbox shows them)
- **WhatsApp:** free replies only within 24 hours of the customer's last message. After that, reply by SMS or wait for
  them to write again.
- **Messenger / Instagram:** normal replies within 24 hours; staff (not the AI) can reply up to 7 days.
- **Comments:** a public reply any time; a private reply (opens a Messenger chat) once per comment, within 7 days.

## Local demo
`DATABASE_URL=<a dev/test database> npx tsx apps/api/scripts/seed-social-inbox-demo.ts` fills the Inbox with sample
WhatsApp, Messenger, Instagram and comment threads, including AI drafts.
