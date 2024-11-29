const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;
const schedule = require('node-schedule');

// Bot uchun sozlamalar
const TOKEN = '7553731592:AAGe0e4MWb0y-bYQekw_vPPe5s-h6ezliV0';
const GROUP_CHAT_ID = '-4522225596'; // Guruh chat ID
const ADMIN_ID = '6672988695'; // Admin Telegram foydalanuvchi ID'sini shu yerga qo‘ying
const databasePath = './attendance.json';
const bot = new TelegramBot(TOKEN, { polling: true });

// JSON bazasi bilan ishlash
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

// Kelgan vaqti bilan ishlash
async function handleArrival(msg) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0];
    const userId = msg.from.id.toString();

    let database = await loadDatabase();

    // Foydalanuvchi ma'lumotlarini tayyorlash
    if (!database[userId]) {
        database[userId] = {
            name: msg.from.first_name || '',
            username: msg.from.username || '',
            attendance: {}
        };
    }

    if (!database[userId].attendance[today]) {
        // 08:00 vaqtini olish
        const standardArrivalTime = new Date(`${today}T08:00:00`);
        const arrivalTime = new Date(`${today}T${time}`);

        // Farqni hisoblash
        const timeDifference = (arrivalTime - standardArrivalTime) / 60000; // Millisekundni minutga o‘tkazish
        let lateBy = '';
        let earlyBy = '';

        if (timeDifference > 0) {
            lateBy = formatDuration(timeDifference * 60000); // Kech qolgan vaqtni formatlash
        } else if (timeDifference < 0) {
            earlyBy = formatDuration(-timeDifference * 60000); // Erta kelgan vaqtni formatlash
        }

        // Ma'lumotlarni bazaga yozish
        database[userId].attendance[today] = {
            kelgan_vaqti: time,
            ketgan_vaqti: "",
            kech_qolgan_vaqti: lateBy,
            erta_kelgan_vaqti: earlyBy,
            qoshimcha_ishlangan_vaqt: "",
            kelmaganlik_sababi: ""
        };

        // Xabarni yuborish
        let message = `${msg.from.first_name} kelgan vaqti saqlandi: ${time}`;
        if (lateBy) {
            message += `\nSiz ${lateBy} kech qoldingiz.`;
        } else if (earlyBy) {
            message += `\nSiz ${earlyBy} erta keldingiz.`;
        }
        bot.sendMessage(GROUP_CHAT_ID, message);
    } else {
        bot.sendMessage(GROUP_CHAT_ID, `${msg.from.first_name}, kelgan vaqtingiz allaqachon saqlangan.`);
    }

    await saveDatabase(database);
}


// Ketgan vaqti bilan ishlash
async function handleDeparture(msg) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0];
    const userId = msg.from.id.toString();

    let database = await loadDatabase();

    if (!database[userId] || !database[userId].attendance[today]) {
        bot.sendMessage(GROUP_CHAT_ID, `${msg.from.first_name}, avval /keldim habarini yuboring.`);
        return;
    }

    const kelganVaqti = database[userId].attendance[today].kelgan_vaqti;
    const kelganTime = new Date(`${today}T${kelganVaqti}`);
    const ketganTime = new Date(`${today}T${time}`);
    const workDuration = (ketganTime - kelganTime) / 60000; // Minutes

    let qoshimchaIshVaqti = "";
    if (ketganTime > new Date(`${today}T20:00:00`)) {
        qoshimchaIshVaqti = formatDuration(ketganTime - new Date(`${today}T20:00:00`));
    }

    database[userId].attendance[today].ketgan_vaqti = time;
    database[userId].attendance[today].qoshimcha_ishlangan_vaqt = qoshimchaIshVaqti;

    await saveDatabase(database);

    bot.sendMessage(GROUP_CHAT_ID, `${msg.from.first_name} ketgan vaqti saqlandi: ${time}`);
}

// Kelmaganlik sababini yozish
async function handleReason(msg, reason) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const userId = msg.from.id.toString();

    let database = await loadDatabase();

    if (!database[userId] || !database[userId].attendance[today]) {
        bot.sendMessage(GROUP_CHAT_ID, `${msg.from.first_name}, avval /keldim habarini yuboring.`);
        return;
    }

    database[userId].attendance[today].kelmaganlik_sababi = reason;
    await saveDatabase(database);

    bot.sendMessage(GROUP_CHAT_ID, `${msg.from.first_name} kelmaganlik sababini saqladi: ${reason}`);
}

// Hisobotni shakllantirish va yuborish
async function sendDailyReport() {
    const today = new Date().toISOString().split('T')[0];
    let database = await loadDatabase();

    const report = Object.keys(database).map(userId => {
        const user = database[userId];
        const attendance = user.attendance[today] || {};
        return `${user.name}: Kelgan - ${attendance.kelgan_vaqti || 'Noma\'lum'}, Ketgan - ${attendance.ketgan_vaqti || 'Noma\'lum'}`;
    }).join('\n');

    bot.sendMessage(GROUP_CHAT_ID, `Bugungi hisobot:\n${report}`);
}

// Vaqtni formatlash yordamchi funksiyasi
function formatDuration(milliseconds) {
    const totalMinutes = Math.floor(milliseconds / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours} soat ${minutes} daqiqa`;
}

// Ishchilar ro‘yxatini chiqarish
async function sendWorkerList(msg) {
    const userId = msg.from.id.toString();
    if (!isAdmin(userId)) {
        bot.sendMessage(userId, "Kechirasiz, sizda bu buyruqdan foydalanish huquqi yo‘q.");
        return;
    }

    const database = await loadDatabase();
    const workerButtons = Object.keys(database).map(workerId => ({
        text: database[workerId].name,
        callback_data: `worker_${workerId}`
    }));

    const replyMarkup = {
        inline_keyboard: workerButtons.map(button => [button])
    };

    bot.sendMessage(userId, "Ishchilar ro‘yxati:", { reply_markup: replyMarkup });
}

// Tugmalarni qayta ishlash
bot.on('callback_query', async (callbackQuery) => {
    const data = callbackQuery.data;
    const userId = callbackQuery.from.id.toString();

    if (!isAdmin(userId)) {
        bot.answerCallbackQuery(callbackQuery.id, "Sizda bu amalni bajarish huquqi yo‘q.");
        return;
    }

    if (data.startsWith('worker_')) {
        const selectedWorkerId = data.split('_')[1];

        const reportButtons = [
            { text: "Kunlik hisobot", callback_data: `day_${selectedWorkerId}` },
            { text: "Oylik hisobot", callback_data: `month_${selectedWorkerId}` }
        ];

        const replyMarkup = {
            inline_keyboard: [reportButtons]
        };

        bot.editMessageText("Hisobot turini tanlang:", {
            chat_id: callbackQuery.message.chat.id,
            message_id: callbackQuery.message.message_id,
            reply_markup: replyMarkup
        });
    } else if (data.startsWith('day_')) {
        const selectedWorkerId = data.split('_')[1];
        await sendDayReport(userId, selectedWorkerId);
    } else if (data.startsWith('month_')) {
        const selectedWorkerId = data.split('_')[1];
        await sendMonthReport(userId, selectedWorkerId);
    }
});

// Kunlik hisobot
async function sendDayReport(adminId, workerId) {
    const database = await loadDatabase();
    const today = new Date().toISOString().split('T')[0];

    const user = database[workerId];
    if (!user || !user.attendance[today]) {
        bot.sendMessage(adminId, "Bugungi ma'lumot mavjud emas.");
        return;
    }

    const attendance = user.attendance[today];
    const report = `
👤 Foydalanuvchi: ${user.name}
🕒 Kelgan: ${attendance.kelgan_vaqti || 'Noma\'lum'}
🕔 Ketgan: ${attendance.ketgan_vaqti || 'Noma\'lum'}
`;
    bot.sendMessage(adminId, report);
}


async function sendMonthReport(adminId, workerId) {
    const database = await loadDatabase();
    const currentMonth = new Date().toISOString().split('-')[1];

    const user = database[workerId];
    if (!user) {
        bot.sendMessage(adminId, "Foydalanuvchi topilmadi.");
        return;
    }

    const monthlyAttendance = Object.values(user.attendance).filter(attendance => attendance.kelgan_vaqti);
    const report = monthlyAttendance.map(attendance => `
    📅 ${attendance.kelgan_vaqti} - ${attendance.ketgan_vaqti || 'Noma\'lum'}
    `).join('\n');

    bot.sendMessage(adminId, `Oylik hisobot:\n${report}`);
}


function isAdmin(userId) {
    return userId === ADMIN_ID;
}


bot.onText("keldim", handleArrival);
bot.onText("ketdim", handleDeparture);
bot.onText("kelmadim", (msg) => {
    const reason = msg.text.split(' ')[1];
    handleReason(msg, reason);
});
bot.onText("day", sendDailyReport);
bot.onText("monthly", sendMonthReport);
bot.onText("Hisobot", sendWorkerList);
