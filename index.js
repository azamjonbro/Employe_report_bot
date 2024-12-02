const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;
const schedule = require('node-schedule');

// Bot uchun sozlamalar
const TOKEN = '7595945428:AAF1jngsurhhbqHqhBJDVeVSq00xEHzDXsY';
const GROUP_CHAT_ID = '-1002401400816'; // Guruh chat ID
const ADMIN_ID = '5011116923'; 
const databasePath = './attendance.json';
const bot = new TelegramBot(TOKEN, { polling: true });

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

    if (!database[userId]) {
        database[userId] = {
            name: msg.from.first_name || '',
            username: msg.from.username || '',
            attendance: {}
        };
    }

    if (!database[userId].attendance[today]) {
        const standardArrivalTime = new Date(`${today}T08:00:00`);
        const arrivalTime = new Date(`${today}T${time}`);
        const timeDifference = (arrivalTime - standardArrivalTime) / 60000;
        let lateBy = '';
        let earlyBy = '';

        if (timeDifference > 0) {
            lateBy = formatDuration(timeDifference * 60000);
        } else if (timeDifference < 0) {
            earlyBy = formatDuration(-timeDifference * 60000);
        }

        database[userId].attendance[today] = {
            kelgan_vaqti: time,
            ketgan_vaqti: '',
            kech_qolgan_vaqti: lateBy,
            erta_kelgan_vaqti: earlyBy,
            qoshimcha_ishlangan_vaqt: '',
            kelmaganlik_sababi: ''
        };
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
    const workDuration = (ketganTime - kelganTime) / 60000;

    let qoshimchaIshVaqti = '';
    let  erta_kelgan_vaqti = ""
    if (ketganTime > new Date(`${today}T20:00:00`)) {
        qoshimchaIshVaqti = formatDuration(ketganTime - new Date(`${today}T20:00:00`));
    }
    if (ketganTime < new Date(`${today}T20:00:00`)) {
        erta_kelgan_vaqti = formatDuration(ketganTime - new Date(`${today}T20:00:00`));
    }

    database[userId].attendance[today].ketgan_vaqti = time;
    database[userId].attendance[today].erta_kelgan_vaqti=erta_kelgan_vaqti
    database[userId].attendance[today].qoshimcha_ishlangan_vaqt = qoshimchaIshVaqti;

    await saveDatabase(database);
}

// Kunlik hisobotni guruh uchun yuborish
async function sendDailyReport(msg) {
    const userId = msg.from.id.toString();

    if (!isAdmin(userId)) {
        bot.sendMessage(userId, "Sizda bu buyruqni bajarish huquqi yo'q.");
        return;
    }

    const today = new Date().toISOString().split('T')[0];
    const database = await loadDatabase();

    let report = `📋 *Bugungi hisobot (${today}):*\n`;

    for (const userId in database) {
        const user = database[userId];
        const attendance = user.attendance[today] || {};
        report += `
👤 *${user.name}*:
  ⏰ Kelgan: ${attendance.kelgan_vaqti || '❓ Noma\'lum'}
  🕒 Ketgan: ${attendance.ketgan_vaqti || '❓ Noma\'lum'}
  🚶‍♂️ Kech qolgan: ${attendance.kech_qolgan_vaqti || '❓ Yo‘q'}
  🕓 Erta ketgan: ${attendance.erta_kelgan_vaqti || '❓ Yo‘q'}
  🏢 Qo‘shimcha ish: ${attendance.qoshimcha_ishlangan_vaqt || '❓ Yo‘q'}
        `;
    }

    bot.sendMessage(ADMIN_ID, report, { parse_mode: "Markdown" });
}

// Foydalanuvchi ro‘yxatini chiqarish
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

// Hisobot tugmalari bilan ishlash
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

// Qo'llab-quvvatlash funksiyalari
function isAdmin(userId) {
    return userId === ADMIN_ID;
}

function formatDuration(ms) {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours} soat ${remainingMinutes} daqiqa`;
}
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
    const currentMonth = new Date().toISOString().split('-')[1]; // Hozirgi oyni olish

    const user = database[workerId];
    if (!user) {
        bot.sendMessage(adminId, "Foydalanuvchi topilmadi.");
        return;
    }

    // Joriy oy uchun qatnovlarni filtrlash
    const monthlyAttendance = Object.entries(user.attendance)
        .filter(([date]) => date.split('-')[1] === currentMonth); // Sana orqali oyni tekshiramiz

    if (monthlyAttendance.length === 0) {
        bot.sendMessage(adminId, "Bu foydalanuvchining joriy oy uchun ma'lumotlari yo'q.");
        return;
    }

    let totalWorkedTime = 0; 
    const report = monthlyAttendance.map(([date, attendance]) => {
        const startTime = new Date(`${date}T${attendance.kelgan_vaqti}`);
        const endTime = attendance.ketgan_vaqti ? new Date(`${date}T${attendance.ketgan_vaqti}`) : null;
        const workedTime = endTime ? (endTime - startTime) / 1000 : 0; 
        totalWorkedTime += workedTime;

        return ` Ishchi : ${user.name}
        📅 ${date} (${attendance.kelgan_vaqti} - ${attendance.ketgan_vaqti || 'Noma\'lum'})
    Ishlangan vaqt: ${workedTime ? formatTime(workedTime) : 'Noma\'lum'}
    -------------------------------
    `;
    }).join('\n');

    const totalWorkedFormatted = formatTime(totalWorkedTime);

    bot.sendMessage(adminId, `Oylik hisobot:\n${report}\n\nUmumiy ishlagan vaqt: ${totalWorkedFormatted}`);
}
async function sendAllWorkersMonthReport() {
    const database = await loadDatabase();
    const currentMonth = new Date().toISOString().split('-')[1]; // Hozirgi oyni olamiz

    let overallReport = ''; // Umumiy hisobotni yig'ish uchun o'zgaruvchi

    for (const workerId in database) {
        const user = database[workerId];
        const attendanceRecords = Object.entries(user.attendance) // `attendance`ni kirish vaqti bilan array formatida olamiz
            .filter(([date]) => date.split('-')[1] === currentMonth); // Faqat joriy oyni filtrlaymiz

        if (attendanceRecords.length === 0) continue; // Agar oylik ma'lumot bo'lmasa, o'tkazib yuboriladi

        let totalWorkedTime = 0; // Ishlangan umumiy vaqt (soniyalarda)
        const workerReport = attendanceRecords.map(([date, attendance]) => {
            const startTime = new Date(`2024-01-01T${attendance.kelgan_vaqti}`); // Vaqtni `Date` formatiga aylantirish
            const endTime = attendance.ketgan_vaqti ? new Date(`2024-01-01T${attendance.ketgan_vaqti}`) : null;

            const workedTime = endTime ? (endTime - startTime) / 1000 : 0; // Soniyalarda farq
            totalWorkedTime += workedTime;

            return `
    📅 ${date}
    Kelgan vaqti: ${attendance.kelgan_vaqti}
    Ketgan vaqti: ${attendance.ketgan_vaqti || 'Noma\'lum'}
    Ishlangan vaqt: ${workedTime ? formatTime(workedTime) : 'Noma\'lum'}
    Kech qolgan vaqt: ${attendance.kech_qolgan_vaqti || 'Yo\'q'}
    Erta kelgan vaqt: ${attendance.erta_kelgan_vaqti || 'Yo\'q'}
    Qo'shimcha ishlangan vaqt: ${attendance.qoshimcha_ishlangan_vaqt || 'Yo\'q'}
    Kelmaganlik sababi: ${attendance.kelmaganlik_sababi || 'Yo\'q'}
    `;
        }).join('\n');

        const totalWorkedFormatted = formatTime(totalWorkedTime);

        overallReport += `
👤 Ishchi: ${user.name || 'Noma\'lum'}
Username: @${user.username || 'Noma\'lum'}
${workerReport}
Umumiy ishlagan vaqt: ${totalWorkedFormatted}

--------------------------------------
`;
    }

    if (overallReport.trim() === '') {
        bot.sendMessage(ADMIN_ID, "Hech qanday ishchining oylik hisobotlari topilmadi.");
    } else {
        bot.sendMessage(ADMIN_ID, `Hamma ishchilarning oylik hisobotlari:\n${overallReport}`);
    }
}
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours} soat, ${minutes} daqiqa, ${secs} soniya`;
}
function isAdmin(userId) {
    return userId === ADMIN_ID;
}
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
schedule.scheduleJob('30 9 * * *', () => bot.sendMessage(GROUP_CHAT_ID, "⏰ Siz ishga keldingizmi? Iltimos, /keldim buyrug'ini yuboring!"));
schedule.scheduleJob('0 20 * * *', () => bot.sendMessage(GROUP_CHAT_ID, "⏰ Ish vaqti tugadi! Iltimos, /ketdim buyrug‘ini yuboring!"));


bot.onText("keldim", handleArrival);
bot.onText("ketdim", handleDeparture);
bot.onText("kelmadim", (msg) => {
    const reason = msg.text.split(' ')[1];
    handleReason(msg, reason);
});
bot.onText("day", sendDailyReport);
bot.onText("monthly", sendAllWorkersMonthReport);
bot.onText("Hisobot", sendWorkerList);
