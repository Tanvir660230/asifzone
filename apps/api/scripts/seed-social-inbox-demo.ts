/**
 * Local demo data for the Social Inbox (WhatsApp, Messenger, Instagram, comments, AI drafts and answers) — for looking
 * at the Inbox on a dev or test database. Refuses to run in production. Re-running replaces the demo threads.
 *   DATABASE_URL=<db> npx tsx scripts/seed-social-inbox-demo.ts
 */
import { PrismaClient } from "@prisma/client";

if (process.env.NODE_ENV === "production") throw new Error("Demo data is for local databases only");
const prisma = new PrismaClient();
const MIN = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN);

type Msg = { body: string; out?: "STAFF" | "AI" | "PHONE"; at: number; channel?: "WHATSAPP" | "MESSENGER" | "INSTAGRAM" | "FB_COMMENT" | "SMS" };

async function thread(t: {
  key: string;
  channel: "WHATSAPP" | "MESSENGER" | "INSTAGRAM" | "FB_COMMENT";
  subject: string;
  name: string;
  phone?: string;
  status: "OPEN" | "HANDLED";
  messages: Msg[];
  draft?: { body: string; intent: string };
}) {
  const externalThreadId = `demo-${t.key}`;
  await prisma.conversation.deleteMany({ where: { channel: t.channel, externalThreadId } });
  const lastIn = t.messages.filter((m) => !m.out).at(-1);
  const c = await prisma.conversation.create({
    data: {
      channel: t.channel,
      externalThreadId,
      subject: t.subject,
      contactName: t.name,
      phone: t.phone ?? null,
      status: t.status,
      lastInboundAt: lastIn ? ago(lastIn.at) : null,
      lastMessageAt: ago(t.messages.at(-1)!.at),
      createdAt: ago(t.messages[0]!.at),
      postId: t.channel === "FB_COMMENT" ? "100200300_888" : null,
      messages: {
        create: t.messages.map((m, i) => ({
          direction: m.out ? "OUT" : "IN",
          channel: m.channel ?? t.channel,
          body: m.body,
          author: m.out ?? "CUSTOMER",
          externalId: `demo-${t.key}-${i}`,
          createdAt: ago(m.at),
        })),
      },
    },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (t.draft) {
    await prisma.conversationDraft.create({ data: { conversationId: c.id, ...t.draft, basedOnMessageId: c.messages.at(-1)!.id } });
  }
}

async function main() {
  await thread({
    key: "wa-rahim",
    channel: "WHATSAPP",
    subject: "WhatsApp chat",
    name: "Rahim Uddin",
    phone: "01812345678",
    status: "OPEN",
    messages: [{ body: "Assalamu alaikum bhai, kalo panjabi ta ki ache? Size L lagbe", at: 4 }],
    draft: { body: "Walaikum assalam. Ji, kalo panjabi L size ache, dam 1,450 taka. Order korte pare: https://asifzone.com/product/black-panjabi", intent: "stock" },
  });
  await thread({
    key: "wa-nusrat",
    channel: "WHATSAPP",
    subject: "WhatsApp chat",
    name: "Nusrat Jahan",
    phone: "01712000111",
    status: "HANDLED",
    messages: [
      { body: "Delivery charge koto Chittagong e?", at: 52 },
      { body: "Dhakar baire delivery charge 120 taka. Cash on delivery ache.", out: "AI", at: 51 },
      { body: "Ok thanks", at: 40 },
    ],
  });
  await thread({
    key: "ms-tanha",
    channel: "MESSENGER",
    subject: "Messenger chat",
    name: "Tanha Akter",
    status: "OPEN",
    messages: [
      { body: "Amar parcel e size bhul ashche. M chaisilam, L dise", at: 18 },
      { body: "[Photo]", at: 17 },
    ],
    draft: { body: "Dukkhito, size bhul jawar jonno. Apnar order number ta diben? Amra exchange er bebostha korbo.", intent: "other" },
  });
  await thread({
    key: "ig-sadia",
    channel: "INSTAGRAM",
    subject: "Instagram DM",
    name: "@sadia.style",
    status: "HANDLED",
    messages: [
      { body: "Eid collection kobe ashbe?", at: 300 },
      { body: "Inshallah next week e ashbe apu, page e janiye dibo", out: "PHONE", at: 280 },
    ],
  });
  await thread({
    key: "fb-karim",
    channel: "FB_COMMENT",
    subject: "Comment on a post",
    name: "Karim Ahmed",
    status: "OPEN",
    messages: [{ body: "price?", at: 9 }],
    draft: { body: "Ei panjabi tar dam 1,450 taka, M/L/XL size ache. Link: https://asifzone.com/product/black-panjabi", intent: "price" },
  });
  await thread({
    key: "ms-old",
    channel: "MESSENGER",
    subject: "Messenger chat",
    name: "Shakil Hasan",
    status: "OPEN",
    messages: [{ body: "Order ta kobe pabo? 3 din hoye gelo", at: 30 * 60 }],
  });
  console.log("Social Inbox demo threads ready.");
}

main().finally(() => prisma.$disconnect());
