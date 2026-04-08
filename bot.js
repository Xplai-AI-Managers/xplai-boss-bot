const { Bot, InlineKeyboard } = require('grammy');
const cron = require('node-cron');
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err?.message || err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err?.message || err));

// ─── Config ──────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID || '6696661524';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SUPPORT_URL = process.env.SUPPORT_URL || 'https://support-server-production-0981.up.railway.app';
const DEMO_URL = process.env.DEMO_URL || 'https://demo-chat-production-272b.up.railway.app';
let WEBAPP_URL = process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : '';

if (!BOT_TOKEN) { console.error('BOT_TOKEN required'); process.exit(1); }

const bot = new Bot(BOT_TOKEN);
const claude = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;

bot.catch((err) => console.error('[Grammy]', err.message || err));

// ─── In-memory store ─────────────────────────────────────
const store = {
  leads: [],
  errors: [],
  agents: {
    'demo-chat':      { status: '🟢', url: DEMO_URL },
    'support-server': { status: '🟢', url: SUPPORT_URL },
    'boss-bot':       { status: '🟢', url: null },
  },
  financials: { revenue: 0, expenses: 0, clients: 0, newClients: 0 },
};

// ─── Helpers ─────────────────────────────────────────────
function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

async function checkService(url) {
  try {
    const r = await fetch(url + '/health', { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    return { ok: d.ok, uptime: d.uptime || d.uptimeSeconds || 0, stats: d.stats };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── /start — dashboard menu ─────────────────────────────
bot.command('start', async (ctx) => {
  const kb = new InlineKeyboard();
  if (WEBAPP_URL) {
    kb.webApp('🚀 Открыть дашборд', WEBAPP_URL).row();
  }
  kb.text('📊 Статистика', 'stat').text('🤖 Агенты', 'agents').row()
    .text('📧 Последние письма', 'emails').text('⚙️ Здоровье', 'health');

  await ctx.reply(
    '🏢 *xplai\\.eu — Панель управления*\n\n' +
    'Добро пожаловать, босс\\! Выбери действие:',
    { parse_mode: 'MarkdownV2', reply_markup: kb }
  );
});

// ─── /stat — live statistics ─────────────────────────────
async function getStatText() {
  const support = await checkService(SUPPORT_URL);
  const demo = await checkService(DEMO_URL);

  const ss = support.stats || {};
  const lines = [
    '📊 *Статистика xplai\\.eu*\n',
    `📧 Писем обработано: *${ss.processed || 0}*`,
    `✅ Ответов отправлено: *${ss.replied || 0}*`,
    `🚫 Спам: *${ss.spam || 0}*`,
    `❌ Ошибок: *${ss.errors || 0}*`,
    `⏱ Support uptime: *${formatUptime(support.uptime)}*`,
    `⏱ Demo\\-chat uptime: *${formatUptime(demo.uptime)}*`,
    `👥 Лидов: *${store.leads.length}*`,
  ];
  return lines.join('\n');
}

function formatUptime(s) {
  if (!s) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}ч ${m}м`;
}

bot.command('stat', async (ctx) => {
  await ctx.reply(await getStatText(), { parse_mode: 'MarkdownV2' });
});

// ─── /agents — agent status ──────────────────────────────
async function getAgentsText() {
  const results = await Promise.all([
    checkService(DEMO_URL),
    checkService(SUPPORT_URL),
  ]);

  const lines = [
    '🤖 *Статус агентов*\n',
    `${results[0].ok ? '🟢' : '🔴'} demo\\-chat — ${results[0].ok ? 'online ' + formatUptime(results[0].uptime) : 'OFFLINE'}`,
    `${results[1].ok ? '🟢' : '🔴'} support\\-server — ${results[1].ok ? 'online ' + formatUptime(results[1].uptime) : 'OFFLINE'}`,
    `🟢 boss\\-bot — online ${formatUptime(process.uptime())}`,
  ];
  return lines.join('\n');
}

bot.command('agents', async (ctx) => {
  await ctx.reply(await getAgentsText(), { parse_mode: 'MarkdownV2' });
});

// ─── /health — deep health check ────────────────────────
bot.command('health', async (ctx) => {
  const [demo, support] = await Promise.all([
    checkService(DEMO_URL),
    checkService(SUPPORT_URL),
  ]);

  const all = demo.ok && support.ok;
  const lines = [
    all ? '✅ *Все сервисы работают\\!*\n' : '⚠️ *Есть проблемы\\!*\n',
    `demo\\-chat: ${demo.ok ? '✅ OK' : '❌ ' + (demo.error || 'down')}`,
    `support\\-server: ${support.ok ? '✅ OK' : '❌ ' + (support.error || 'down')}`,
    `boss\\-bot: ✅ OK`,
  ];
  await ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' });
});

// ─── /leads — recent leads ──────────────────────────────
bot.command('leads', async (ctx) => {
  if (store.leads.length === 0) return ctx.reply('📬 Лидов пока нет.');
  const last = store.leads.slice(-10).reverse();
  const lines = last.map((l, i) =>
    `${i + 1}. ${l.name || 'Anonymous'} — ${l.source || 'email'} — ${fmtDate(l.date)}`
  );
  await ctx.reply(`📬 Последние лиды (${store.leads.length}):\n\n` + lines.join('\n'));
});

// ─── /pl — P&L report ────────────────────────────────────
bot.command('pl', async (ctx) => {
  const f = store.financials;
  const profit = f.revenue - f.expenses;
  await ctx.reply(
    `📊 P&L xplai.eu\n\n` +
    `💰 Выручка: €${f.revenue}\n💸 Расходы: €${f.expenses}\n` +
    `${profit >= 0 ? '📈' : '📉'} Прибыль: €${profit}\n` +
    `👥 Клиентов: ${f.clients} | Новых: ${f.newClients}`
  );
});

// ─── /report — daily report now ──────────────────────────
bot.command('report', async (ctx) => {
  await ctx.reply(await getStatText(), { parse_mode: 'MarkdownV2' });
});

// ─── Inline button handlers ──────────────────────────────
bot.callbackQuery('stat', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(await getStatText(), { parse_mode: 'MarkdownV2' });
});

bot.callbackQuery('agents', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(await getAgentsText(), { parse_mode: 'MarkdownV2' });
});

bot.callbackQuery('emails', async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    const r = await fetch(SUPPORT_URL + '/log', { signal: AbortSignal.timeout(5000) });
    const logs = await r.json();
    if (!logs || logs.length === 0) return ctx.reply('📧 Нет недавних писем.');
    const lines = logs.slice(0, 10).map(l =>
      `${l.action === 'REPLIED' ? '✅' : l.action === 'ERROR' ? '❌' : '📩'} ${l.from || '?'} — ${l.reason || l.subject || l.action}`
    );
    await ctx.reply('📧 Последние события:\n\n' + lines.join('\n'));
  } catch (e) {
    await ctx.reply('❌ Не удалось получить логи: ' + e.message);
  }
});

bot.callbackQuery('health', async (ctx) => {
  await ctx.answerCallbackQuery();
  const [demo, support] = await Promise.all([
    checkService(DEMO_URL),
    checkService(SUPPORT_URL),
  ]);
  const all = demo.ok && support.ok;
  await ctx.reply(
    (all ? '✅ Все сервисы ОК\n\n' : '⚠️ Есть проблемы!\n\n') +
    `demo-chat: ${demo.ok ? '✅' : '❌'}\n` +
    `support-server: ${support.ok ? '✅' : '❌'}\n` +
    `boss-bot: ✅`
  );
});

// ─── Free text → Claude CEO assistant ────────────────────
const CEO_PROMPT = `You are a smart CEO assistant for xplai.eu — an AI manager platform for businesses.
You know everything about xplai.eu:
- Products: Chat, Phone, WhatsApp, Email, Omnichannel AI managers
- Pricing: Setup €499-5990, subscriptions €69-1499/mo
- Team: support-server (email agent), demo-chat (website chat), boss-bot (this Telegram bot)
- Tech: Node.js, Claude API (Haiku/Sonnet), Railway, Cloudflare Pages, Resend, Porkbun IMAP
- Clients: restaurants, e-commerce, services in LT, VN, PL, FR
Reply concisely in the same language as the message. Be helpful and proactive.`;

bot.on('message:text', async (ctx) => {
  if (!claude) return ctx.reply('Claude API не настроен.');
  try {
    const r = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: CEO_PROMPT,
      messages: [{ role: 'user', content: ctx.message.text }],
    });
    await ctx.reply(r.content[0].text);
  } catch (e) {
    await ctx.reply('❌ Ошибка Claude: ' + e.message);
  }
});

// ─── Daily report cron (09:00 Vilnius) ───────────────────
cron.schedule('0 9 * * *', async () => {
  try {
    const text = await getStatText();
    await bot.api.sendMessage(CHAT_ID, text, { parse_mode: 'MarkdownV2' });
  } catch (e) {
    console.error('[cron]', e.message);
  }
}, { timezone: 'Europe/Vilnius' });

// ─── HTTP API (webhooks from other services) ─────────────
const app = express();
app.use(express.json());

app.post('/lead', async (req, res) => {
  try {
    const { name, email, phone, source, message } = req.body;
    const lead = { name: name || 'Anonymous', email, phone, source: source || 'chat', message, date: Date.now() };
    store.leads.push(lead);
    store.financials.newClients++;
    await bot.api.sendMessage(CHAT_ID,
      `🔔 Новый лид!\n\n👤 ${lead.name}\n📧 ${email || '—'}\n📱 ${phone || '—'}\n📍 ${lead.source}\n💬 ${(message || '').substring(0, 200)}`
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/error', async (req, res) => {
  try {
    const { agent, error, severity } = req.body;
    store.errors.push({ agent, error, severity, date: Date.now() });
    if (store.agents[agent]) store.agents[agent].status = '🔴';
    await bot.api.sendMessage(CHAT_ID,
      `${severity === 'critical' ? '🚨' : '⚠️'} Ошибка: ${agent}\n❌ ${(error || '').substring(0, 300)}`
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/ping', (req, res) => {
  const { agent } = req.body;
  if (store.agents[agent]) store.agents[agent].status = '🟢';
  res.json({ ok: true });
});

app.post('/financials', (req, res) => {
  const { revenue, expenses, clients, newClients } = req.body;
  if (revenue !== undefined) store.financials.revenue = revenue;
  if (expenses !== undefined) store.financials.expenses = expenses;
  if (clients !== undefined) store.financials.clients = clients;
  if (newClients !== undefined) store.financials.newClients = newClients;
  res.json({ ok: true, financials: store.financials });
});

app.get('/health', (req, res) => res.json({ ok: true, service: 'xplai-boss-bot', uptime: Math.round(process.uptime()) }));

// ─── Mini App: API proxy (avoids CORS issues) ───────────
app.get('/api/support/:path', async (req, res) => {
  try {
    const r = await fetch(SUPPORT_URL + '/' + req.params.path, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    res.json(d);
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/api/demo/:path', async (req, res) => {
  try {
    const r = await fetch(DEMO_URL + '/' + req.params.path, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    res.json(d);
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/chat', async (req, res) => {
  if (!claude) return res.json({ reply: 'Claude API не настроен.' });
  try {
    const r = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 500,
      system: CEO_PROMPT,
      messages: [{ role: 'user', content: req.body.message || '' }],
    });
    res.json({ reply: r.content[0].text });
  } catch (e) { res.json({ reply: '❌ ' + e.message }); }
});

// ─── Static files for Mini App ───────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── Start ───────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[HTTP] Boss bot on port ${PORT}`);
  bot.api.deleteWebhook({ drop_pending_updates: true }).then(() => {
    bot.start({ drop_pending_updates: true, allowed_updates: ['message', 'callback_query'], onStart: () => console.log('[TG] Bot started') });
  }).catch(err => {
    console.error('[TG]', err.message);
    setTimeout(() => {
      bot.api.deleteWebhook({ drop_pending_updates: true }).then(() => bot.start({ drop_pending_updates: true }));
    }, 10000);
  });
});
