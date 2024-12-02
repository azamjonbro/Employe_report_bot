const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;
const schedule = require('node-schedule');

// Load environment variables
require('dotenv').config();

// Bot configurations
const TOKEN = process.env.BOT_TOKEN;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
const ADMIN_ID = process.env.ADMIN_ID;
const databasePath = './attendance.json';

// Initialize the bot
const bot = new TelegramBot(TOKEN, { polling: true });

// Database utilities
async function loadDatabase() {
    try {
        const data = await fs.readFile(databasePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') {
            await saveDatabase({});
            return {};
        }
        throw err;
    }
}

async function saveDatabase(data) {
    await fs.writeFile(databasePath, JSON.stringify(data, null, 2));
}

// Format time duration
function formatDuration(ms) {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours} soat ${remainingMinutes} daqiqa`;
}

// Arrival handler
async function handleArrival(msg) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0];
    const userId = msg.from.id.toString();

    const database = await loadDatabase();

    if (!database[userId]) {
        database[userId] = {
            name: msg.from.first_name || '',
            username: msg.from.username || '',
            attendance: {},
            summary: {
                totalLate: 0,
                totalEarly: 0,
                totalExtra: 0
            }
        };
    }

    if (!database[userId].attendance[today]) {
        const standardArrivalTime = new Date(`${today}T09:00:00`);
        const arrivalTime = new Date(`${today}T${time}`);
        const timeDifference = (arrivalTime - standardArrivalTime) / 60000;
        let lateBy = 0;

        if (timeDifference > 0) {
            lateBy = timeDifference;
        }

        database[userId].attendance[today] = {
            kelgan_vaqti: time,
            ketgan_vaqti: '',
            kech_qolgan_vaqti: lateBy > 0 ? formatDuration(lateBy * 60000) : '',
            qoshimcha_ishlangan_vaqt: '',
            kelmaganlik_sababi: ''
        };

        database[userId].summary.totalLate += lateBy;

        bot.sendMessage(
            GROUP_CHAT_ID,
            `${msg.from.first_name}, kelgan vaqtingiz saqlandi: ${time}` +
            (lateBy > 0 ? `\nSiz ${formatDuration(lateBy * 60000)} kech qoldingiz.` : '')
        );
    } else {
        bot.sendMessage(GROUP_CHAT_ID, `${msg.from.first_name}, kelgan vaqtingiz allaqachon saqlangan.`);
    }

    await saveDatabase(database);
}

// Departure handler
async function handleDeparture(msg) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0];
    const userId = msg.from.id.toString();

    const database = await loadDatabase();

    if (!database[userId] || !database[userId].attendance[today]) {
        bot.sendMessage(GROUP_CHAT_ID, `${msg.from.first_name}, avval /keldim habarini yuboring.`);
        return;
    }

    const kelganVaqti = database[userId].attendance[today].kelgan_vaqti;
    const kelganTime = new Date(`${today}T${kelganVaqti}`);
    const ketganTime = new Date(`${today}T${time}`);
    const workDuration = (ketganTime - kelganTime) / 60000;

    let qoshimchaIshVaqti = 0;
    if (ketganTime > new Date(`${today}T20:00:00`)) {
        qoshimchaIshVaqti = (ketganTime - new Date(`${today}T20:00:00`)) / 60000;
    }

    database[userId].attendance[today].ketgan_vaqti = time;
    database[userId].attendance[today].qoshimcha_ishlangan_vaqt = qoshimchaIshVaqti > 0 ? formatDuration(qoshimchaIshVaqti * 60000) : '';
    database[userId].summary.totalExtra += qoshimchaIshVaqti;

    await saveDatabase(database);

    bot.sendMessage(GROUP_CHAT_ID, `${msg.from.first_name}, ketgan vaqtingiz saqlandi: ${time}`);
}

// Send reminders
schedule.scheduleJob('30 9 * * *', () => bot.sendMessage(GROUP_CHAT_ID, "⏰ Siz 9:30 da ishga keldingizmi? Iltimos, /keldim buyrug'ini yuboring!"));
schedule.scheduleJob('0 20 * * *', () => bot.sendMessage(GROUP_CHAT_ID, "⏰ Ish vaqti tugadi! Iltimos, /ketdim buyrug‘ini yuboring!"));

// Mark absentees
schedule.scheduleJob('0 22 * * *', async () => {
    const today = new Date().toISOString().split('T')[0];
    const database = await loadDatabase();

    for (const userId in database) {
        if (!database[userId].attendance[today] || !database[userId].attendance[today].ketgan_vaqti) {
            database[userId].attendance[today] = database[userId].attendance[today] || {};
            database[userId].attendance[today].kelmaganlik_sababi = 'Ishga kelmagan';
        }
    }

    await saveDatabase(database);
});

// Handle /day command
async function handleDayCommand(msg) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const database = await loadDatabase();

    let report = `📅 *Bugungi hisobot* (${today}):\n\n`;
    for (const userId in database) {
        const user = database[userId];
        const attendance = user.attendance[today];

        if (attendance) {
            report += `👤 ${user.name || user.username || 'Noma‘lum'}\n` +
                      `   - Kelgan vaqti: ${attendance.kelgan_vaqti || '⏳ Yo‘q'}\n` +
                      `   - Ketgan vaqti: ${attendance.ketgan_vaqti || '⏳ Yo‘q'}\n` +
                      `   - Kech qolgan vaqt: ${attendance.kech_qolgan_vaqti || '✅ Yo‘q'}\n` +
                      `   - Qo‘shimcha ishlagan vaqt: ${attendance.qoshimcha_ishlangan_vaqt || '✅ Yo‘q'}\n\n`;
        } else {
            report += `👤 ${user.name || user.username || 'Noma‘lum'} - Bugun kelmagan.\n\n`;
        }
    }

    bot.sendMessage(msg.chat.id, report, { parse_mode: 'Markdown' });
}

// Handle /month command
async function handleMonthCommand(msg) {
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const database = await loadDatabase();

    let report = `📅 *Oylik hisobot* (${firstDayOfMonth} - ${now.toISOString().split('T')[0]}):\n\n`;

    for (const userId in database) {
        const user = database[userId];
        report += `👤 ${user.name || user.username || 'Noma‘lum'}:\n` +
                  `   - Kech qolgan vaqtlar: ${formatDuration(user.summary.totalLate * 60000)}\n` +
                  `   - Qo‘shimcha ishlangan vaqt: ${formatDuration(user.summary.totalExtra * 60000)}\n\n`;
    }

    bot.sendMessage(msg.chat.id, report, { parse_mode: 'Markdown' });
}

// Commands
bot.onText(/\/keldim/, handleArrival);
bot.onText(/\/ketdim/, handleDeparture);
bot.onText(/\/day/, handleDayCommand);
bot.onText(/\/month/, handleMonthCommand);

console.log('Bot started...');
