const { Bot } = require('grammy');
const cron = require('node-cron');

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));

// ─── Config ──────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID || '6696661524';

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is required');
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

// ─── In-memory storage ──────────────────────────────────
const store = {
  leads: [],
  errors: [],
  agents: {
    'demo-chat':  { status: '🟢 online', lastPing: Date.now() },
    'support':    { status: '🟢 online', lastPing: Date.now() },
    'accountant': { status: '🟢 online', lastPing: Date.now() },
    'seo-lt':     { status: '🟢 online', lastPing: Date.now() },
    'seo-vn':     { status: '🟢 online', lastPing: Date.now() },
    'smm':        { status: '🟢 online', lastPing: Date.now() },
  },
  financials: {
    revenue: 0,
    expenses: 0,
    clients: 0,
    newClients: 0,
  },
};

// ─── Helpers ─────────────────────────────────────────────
function esc(t) { return t.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&'); }

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

async function send(text) {
  try {
    await bot.api.sendMessage(CHAT_ID, text, { parse_mode: 'MarkdownV2' });
  } catch (e) {
    // fallback to plain text
    await bot.api.sendMessage(CHAT_ID, text.replace(/\\/g, ''));
  }
}

// ─── Daily report (09:00 EET) ────────────────────────────
function buildDailyReport() {
  const f = store.financials;
  const profit = f.revenue - f.expenses;
  const sign = profit >= 0 ? '📈' : '📉';
  const today = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric' });
  const leadsToday = store.leads.filter(l => {
    const d = new Date(l.date);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length;

  return [
    `📊 *Отчёт xplai\\.eu — ${esc(today)}*`,
    ``,
    `💰 Выручка: €${f.revenue} \\| Расходы: €${f.expenses}`,
    `${sign} Прибыль: €${profit}`,
    `👥 Клиентов: ${f.clients} \\| Новых: ${f.newClients}`,
    `📬 Лидов сегодня: ${leadsToday} \\| Всего: ${store.leads.length}`,
    ``,
    `🤖 *Агенты:*`,
    ...Object.entries(store.agents).map(([name, a]) => `  ${a.status} ${esc(name)}`),
    ``,
    store.errors.length > 0
      ? `⚠️ Ошибок за сутки: ${store.errors.length}`
      : `✅ Ошибок нет`,
  ].join('\n');
}

// Cron: every day at 09:00 EET (Europe/Vilnius = UTC+2/+3)
cron.schedule('0 9 * * *', () => {
  send(buildDailyReport());
}, { timezone: 'Europe/Vilnius' });

// ─── Commands ────────────────────────────────────────────

// /start
bot.command('start', (ctx) => {
  ctx.reply(
    '👋 Привет, босс! Я бот xplai.eu.\n\n' +
    'Команды:\n' +
    '/status — статус всех агентов\n' +
    '/pl — P&L отчёт\n' +
    '/leads — список лидов\n' +
    '/report — дневной отчёт сейчас'
  );
});

// /status — статус агентов
bot.command('status', (ctx) => {
  const lines = Object.entries(store.agents).map(([name, a]) => {
    const ago = Math.round((Date.now() - a.lastPing) / 60000);
    return `${a.status} ${name} (ping ${ago}m ago)`;
  });
  ctx.reply('🤖 Статус агентов:\n\n' + lines.join('\n'));
});

// /pl — P&L
bot.command('pl', (ctx) => {
  const f = store.financials;
  const profit = f.revenue - f.expenses;
  ctx.reply(
    `📊 P&L отчёт xplai.eu\n\n` +
    `💰 Выручка: €${f.revenue}\n` +
    `💸 Расходы: €${f.expenses}\n` +
    `${profit >= 0 ? '📈' : '📉'} Прибыль: €${profit}\n\n` +
    `👥 Клиентов: ${f.clients} | Новых: ${f.newClients}`
  );
});

// /leads — список лидов
bot.command('leads', (ctx) => {
  if (store.leads.length === 0) {
    return ctx.reply('📬 Лидов пока нет.');
  }
  const last10 = store.leads.slice(-10).reverse();
  const lines = last10.map((l, i) =>
    `${i + 1}. ${l.name || 'Anonymous'} — ${l.source || 'chat'} — ${fmtDate(l.date)}`
  );
  ctx.reply(`📬 Последние лиды (${store.leads.length} всего):\n\n` + lines.join('\n'));
});

// /report — отчёт прямо сейчас
bot.command('report', (ctx) => {
  send(buildDailyReport());
});

// ─── Webhook API endpoints (Express) ─────────────────────
const express = require('express');
const app = require('express')();
app.use(express.json());

// POST /lead — новый лид из чата сайта
app.post('/lead', async (req, res) => {
  const { name, email, phone, source, message } = req.body;
  const lead = { name: name || 'Anonymous', email, phone, source: source || 'chat', message, date: Date.now() };
  store.leads.push(lead);
  store.financials.newClients++;

  const text = [
    `🔔 *Новый лид\\!*`,
    ``,
    `👤 ${esc(lead.name)}`,
    email ? `📧 ${esc(email)}` : null,
    phone ? `📱 ${esc(phone)}` : null,
    `📍 Источник: ${esc(lead.source)}`,
    message ? `💬 ${esc(message.substring(0, 200))}` : null,
    ``,
    `📊 Всего лидов: ${store.leads.length}`,
  ].filter(Boolean).join('\n');

  await send(text);
  res.json({ ok: true, totalLeads: store.leads.length });
});

// POST /error — ошибка агента
app.post('/error', async (req, res) => {
  const { agent, error, severity } = req.body;
  const entry = { agent, error, severity: severity || 'high', date: Date.now() };
  store.errors.push(entry);

  // Mark agent as errored
  if (store.agents[agent]) {
    store.agents[agent].status = '🔴 error';
  }

  const icon = severity === 'critical' ? '🚨' : '⚠️';
  const text = [
    `${icon} *Ошибка агента\\!*`,
    ``,
    `🤖 Агент: ${esc(agent || 'unknown')}`,
    `❌ ${esc((error || 'Unknown error').substring(0, 300))}`,
    `🔴 Severity: ${esc(severity || 'high')}`,
  ].join('\n');

  await send(text);
  res.json({ ok: true });
});

// POST /ping — heartbeat от агентов
app.post('/ping', (req, res) => {
  const { agent } = req.body;
  if (store.agents[agent]) {
    store.agents[agent].status = '🟢 online';
    store.agents[agent].lastPing = Date.now();
  }
  res.json({ ok: true });
});

// POST /financials — обновить финансы
app.post('/financials', (req, res) => {
  const { revenue, expenses, clients, newClients } = req.body;
  if (revenue !== undefined) store.financials.revenue = revenue;
  if (expenses !== undefined) store.financials.expenses = expenses;
  if (clients !== undefined) store.financials.clients = clients;
  if (newClients !== undefined) store.financials.newClients = newClients;
  res.json({ ok: true, financials: store.financials });
});

// GET /health
app.get('/health', (req, res) => res.json({ ok: true, service: 'xplai-boss-bot' }));

// ─── Start ───────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Boss bot API listening on port ${PORT}`);

  // Delete any existing webhook, then start long polling
  bot.api.deleteWebhook({ drop_pending_updates: true }).then(() => {
    console.log('Webhook cleared, starting polling...');
    bot.start({
      drop_pending_updates: true,
      onStart: () => console.log('Telegram bot started'),
    });
  }).catch(err => {
    console.error('Bot start error:', err.message);
  });
});
