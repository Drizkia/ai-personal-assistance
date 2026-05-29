const CONFIG = {
  GEMINI_API_KEY: "<API KEY>",
  FONNTE_TOKEN: "<Fonnete Token>",
  CALENDAR_UTAMA: "<Email Google Calendar 1>",
  CALENDAR_TAMBAHAN: "<Email Google Calendar 2>",
  SENDER_PRIBADI: "<Number WhatsApp Main>"
};

/**
 * Webhook entry point for Fonnte
 */
function doPost(e) {
  try {
    const contents = JSON.parse(e.postData.contents);
    
    // Anti loop
    if (contents.is_me || contents.isMe || contents.self || (contents.type || "") === "out") return;
    
    const sender = contents.sender || (contents.data && contents.data.sender) || contents.from || "";
    const userMessage = (contents.message || (contents.data && contents.data.message) || "").trim();
    
    if (!userMessage || !sender) return;

    // 1. Initial AI Call
    let aiResponse = callGemini(userMessage);
    
    // 2. Process potentially multiple rounds of function calling
    // We allow up to 3 rounds to prevent infinite loops but handle multi-step tasks
    for (let i = 0; i < 3; i++) {
      if (aiResponse.candidates[0].content.parts[0].functionCall) {
        const functionCall = aiResponse.candidates[0].content.parts[0].functionCall;
        const result = executeTool(functionCall.name, functionCall.args);
        
        // Feed the result back to Gemini to get a natural response
        aiResponse = callGemini(userMessage, {
          role: "function",
          name: functionCall.name,
          result: result
        }, aiResponse.candidates[0].content.parts);
      } else {
        break;
      }
    }

    // 3. Final response to user
    const finalReply = aiResponse.candidates[0].content.parts[0].text;
    kirimWA(sender, finalReply);

  } catch (err) {
    console.error("ERROR: " + err.message + "\n" + err.stack);
    // Silent fail or notify admin
  }
}

/**
 * Calls Gemini API with tools and instructions
 */
function callGemini(prompt, functionResult = null, previousParts = null) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
  
  const now = new Date();
  const timeContext = `Waktu sekarang: ${Utilities.formatDate(now, "Asia/Jakarta", "EEEE, dd MMMM yyyy HH:mm")} WIB.`;

  const systemInstruction = `Kamu adalah Wolly, asisten pintar milik Dimas Rizki.
Tugas utamamu adalah membantu Dimas mengelola jadwal di Google Calendar.
Gunakan gaya bahasa yang ramah, santai, dan sedikit ceria (gunakan emoji).
Selalu konfirmasi jika berhasil melakukan sesuatu.

Aturan Penting:
1. Kamu punya akses ke alat (tools) untuk mengelola kalender. Gunakan alat tersebut jika user meminta sesuatu terkait jadwal.
2. Jika user ingin cek jadwal, gunakan 'list_events'.
3. Jika user ingin tambah jadwal, gunakan 'add_event'. Pastikan kamu mengekstrak judul, waktu mulai, waktu selesai, lokasi, dan warna jika disebutkan.
4. Jika user ingin hapus jadwal, gunakan 'delete_events'.
5. Jika user ingin cari waktu kosong, gunakan 'find_free_slots'.
6. Jika instruksi user kurang jelas (misal: "tambah rapat" tanpa jam), tanyakan detailnya.
7. ${timeContext}`;

  let contents = [];
  
  if (functionResult && previousParts) {
    // If we are providing a function result, we need to send back the conversation history
    contents.push({ role: "user", parts: [{ text: prompt }] });
    contents.push({ role: "model", parts: previousParts });
    contents.push({
      role: "function",
      parts: [{
        functionResponse: {
          name: functionResult.name,
          response: { content: functionResult.result }
        }
      }]
    });
  } else {
    contents.push({ role: "user", parts: [{ text: prompt }] });
  }

  const payload = {
    contents: contents,
    system_instruction: { parts: [{ text: systemInstruction }] },
    tools: [{
      function_declarations: [
        {
          name: "list_events",
          description: "Melihat daftar agenda/jadwal pada tanggal tertentu.",
          parameters: {
            type: "object",
            properties: {
              date: { type: "string", description: "Tanggal yang ingin dicek (format YYYY-MM-DD)." }
            },
            required: ["date"]
          }
        },
        {
          name: "add_event",
          description: "Menambahkan jadwal atau agenda baru ke kalender.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Judul agenda." },
              startTime: { type: "string", description: "Waktu mulai (ISO 8601, format YYYY-MM-DDTHH:mm:ssZ)." },
              endTime: { type: "string", description: "Waktu selesai (ISO 8601, format YYYY-MM-DDTHH:mm:ssZ)." },
              location: { type: "string", description: "Lokasi acara (opsional)." },
              color: { type: "string", description: "Warna label (merah, pink, kuning, hijau, tosca, biru, abu)." }
            },
            required: ["title", "startTime", "endTime"]
          }
        },
        {
          name: "delete_events",
          description: "Menghapus satu atau lebih agenda berdasarkan kata kunci judul atau waktu.",
          parameters: {
            type: "object",
            properties: {
              keyword: { type: "string", description: "Kata kunci nama agenda yang ingin dihapus." },
              date: { type: "string", description: "Tanggal agenda tersebut (format YYYY-MM-DD)." }
            },
            required: ["date"]
          }
        },
        {
          name: "find_free_slots",
          description: "Mencari waktu kosong (lebih dari 30 menit) pada hari tertentu.",
          parameters: {
            type: "object",
            properties: {
              date: { type: "string", description: "Tanggal yang ingin dicek (format YYYY-MM-DD)." }
            },
            required: ["date"]
          }
        }
      ]
    }]
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  };

  const response = UrlFetchApp.fetch(url, options);
  return JSON.parse(response.getContentText());
}

/**
 * Dispatcher for AI Tool calls
 */
function executeTool(name, args) {
  switch (name) {
    case "list_events":
      return toolListEvents(args.date);
    case "add_event":
      return toolAddEvent(args.title, args.startTime, args.endTime, args.location, args.color);
    case "delete_events":
      return toolDeleteEvents(args.date, args.keyword);
    case "find_free_slots":
      return toolFindFreeSlots(args.date);
    default:
      return "Fungsi tidak ditemukan.";
  }
}

// --- CALENDAR TOOL IMPLEMENTATIONS ---

function toolListEvents(dateStr) {
  const date = new Date(dateStr);
  const calendarUtama = CalendarApp.getCalendarById(CONFIG.CALENDAR_UTAMA);
  const calendarTambahan = CalendarApp.getCalendarById(CONFIG.CALENDAR_TAMBAHAN);
  
  let events = [];
  if (calendarUtama) events = events.concat(calendarUtama.getEventsForDay(date));
  if (calendarTambahan) events = events.concat(calendarTambahan.getEventsForDay(date));
  
  events.sort((a, b) => a.getStartTime() - b.getStartTime());
  
  if (events.length === 0) return "Tidak ada agenda untuk tanggal tersebut.";
  
  return events.map((e, i) => {
    const start = Utilities.formatDate(e.getStartTime(), "Asia/Jakarta", "HH:mm");
    const end = Utilities.formatDate(e.getEndTime(), "Asia/Jakarta", "HH:mm");
    return `${i + 1}. ${e.getTitle()} (${start} - ${end}${e.getLocation() ? ' @' + e.getLocation() : ''})`;
  }).join("\n");
}

function toolAddEvent(title, startISO, endISO, location, colorName) {
  const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_UTAMA);
  const start = new Date(startISO);
  const end = new Date(endISO);
  
  const event = calendar.createEvent(title, start, end);
  if (location) event.setLocation(location);
  
  const warnaMap = {
    "merah": CalendarApp.EventColor.RED,
    "pink": CalendarApp.EventColor.PINK,
    "kuning": CalendarApp.EventColor.YELLOW,
    "hijau": CalendarApp.EventColor.GREEN,
    "tosca": CalendarApp.EventColor.TEAL,
    "biru": CalendarApp.EventColor.BLUE,
    "abu": CalendarApp.EventColor.GRAY
  };
  if (colorName && warnaMap[colorName.toLowerCase()]) {
    event.setColor(warnaMap[colorName.toLowerCase()]);
  }
  
  event.addPopupReminder(30);
  
  // Notif ke nomor pribadi Dimas
  const msgNotif = `🔔 *Jadwal Baru*\n📌 ${title}\n⏰ ${Utilities.formatDate(start, "Asia/Jakarta", "HH:mm")} - ${Utilities.formatDate(end, "Asia/Jakarta", "HH:mm")}\n📅 ${Utilities.formatDate(start, "Asia/Jakarta", "dd MMM yyyy")}`;
  kirimWA(CONFIG.SENDER_PRIBADI, msgNotif);
  
  return `Sukses mencatat "${title}" pada ${Utilities.formatDate(start, "Asia/Jakarta", "dd MMM yyyy")} jam ${Utilities.formatDate(start, "Asia/Jakarta", "HH:mm")}.`;
}

function toolDeleteEvents(dateStr, keyword) {
  const date = new Date(dateStr);
  const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_UTAMA);
  const events = calendar.getEventsForDay(date);
  
  let deletedCount = 0;
  let names = [];
  
  events.forEach(e => {
    if (!keyword || e.getTitle().toLowerCase().includes(keyword.toLowerCase())) {
      names.push(e.getTitle());
      e.deleteEvent();
      deletedCount++;
    }
  });
  
  if (deletedCount === 0) return "Tidak ditemukan agenda yang cocok untuk dihapus.";
  return `Berhasil menghapus ${deletedCount} agenda: ${names.join(", ")}`;
}

function toolFindFreeSlots(dateStr) {
  const date = new Date(dateStr);
  const calendarUtama = CalendarApp.getCalendarById(CONFIG.CALENDAR_UTAMA);
  const calendarTambahan = CalendarApp.getCalendarById(CONFIG.CALENDAR_TAMBAHAN);
  
  let events = [];
  if (calendarUtama) events = events.concat(calendarUtama.getEventsForDay(date));
  if (calendarTambahan) events = events.concat(calendarTambahan.getEventsForDay(date));
  
  events.sort((a, b) => a.getStartTime() - b.getStartTime());
  
  let pointer = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
  const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
  let freeSlots = [];
  
  events.forEach(e => {
    if (e.getStartTime() > pointer) {
      const diff = (e.getStartTime() - pointer) / (1000 * 60);
      if (diff >= 30) {
        freeSlots.push(`${Utilities.formatDate(pointer, "Asia/Jakarta", "HH:mm")} - ${Utilities.formatDate(e.getStartTime(), "Asia/Jakarta", "HH:mm")} (${diff} menit)`);
      }
    }
    if (e.getEndTime() > pointer) pointer = e.getEndTime();
  });
  
  if (endOfDay > pointer) {
    const diff = (endOfDay - pointer) / (1000 * 60);
    if (diff >= 30) {
      freeSlots.push(`${Utilities.formatDate(pointer, "Asia/Jakarta", "HH:mm")} - 23:59 (${Math.floor(diff)} menit)`);
    }
  }
  
  return freeSlots.length > 0 ? "Slot kosong:\n" + freeSlots.join("\n") : "Tidak ada slot kosong lebih dari 30 menit.";
}

/**
 * Send WhatsApp via Fonnte
 */
function kirimWA(target, message) {
  UrlFetchApp.fetch("https://api.fonnte.com/send", {
    "method": "post",
    "headers": { "Authorization": CONFIG.FONNTE_TOKEN },
    "payload": { "target": target, "message": message }
  });
}

/**
 * GET: Cek event untuk ESP32 (Mochi Backend)
 */
function doGet(e) {
  const action = e.parameter.action;
  if (action === "cekMochi") {
    const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_UTAMA);
    const now = new Date();
    const satuJamLagi = new Date(now.getTime() + (60 * 60 * 1000));
    const events = calendar.getEvents(now, satuJamLagi);
    if (events.length > 0) {
      return ContentService.createTextOutput("ADA|" + events[0].getTitle())
            .setMimeType(ContentService.MimeType.TEXT);
    } else {
      return ContentService.createTextOutput("KOSONG")
            .setMimeType(ContentService.MimeType.TEXT);
    }
  }
  return ContentService.createTextOutput("Mochi Backend is Active!");
}

