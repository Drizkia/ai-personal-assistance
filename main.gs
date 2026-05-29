function doPost(e) {
  var token = "y8r69Mn9yQgmedxDfNP2";
  var senderBackup = "";
  
  try {
    // Kalender utama untuk tulis, kalender tambahan untuk baca
    var calendarUtama = CalendarApp.getCalendarById("-");
    var calendarTambahan = CalendarApp.getCalendarById("-");

    var contents = JSON.parse(e.postData.contents);
    
    // Anti loop
    var isFromMe = contents.is_me || contents.isMe || contents.self || false;
    if (isFromMe) return;
    if ((contents.type || "") === "out") return;
    
    var sender = contents.sender || (contents.data && contents.data.sender) || contents.from || "";
    senderBackup = sender;
    
    var pesanMasuk = (contents.message || (contents.data && contents.data.message) || "").toLowerCase();
    var balasan = "";

    // Helper: ambil events dari SEMUA kalender di tanggal tertentu
    function getEventsGabungan(tanggal) {
      var hasil = [];
      var e1 = calendarUtama ? calendarUtama.getEventsForDay(tanggal) : [];
      var e2 = calendarTambahan ? calendarTambahan.getEventsForDay(tanggal) : [];
      for (var i = 0; i < e1.length; i++) hasil.push(e1[i]);
      for (var i = 0; i < e2.length; i++) hasil.push(e2[i]);
      hasil.sort(function(a, b) { return a.getStartTime() - b.getStartTime(); });
      return hasil;
    }

    // Helper: ambil events dari SEMUA kalender di range waktu
    function getEventsGabunganRange(mulai, selesai) {
      var hasil = [];
      var e1 = calendarUtama ? calendarUtama.getEvents(mulai, selesai) : [];
      var e2 = calendarTambahan ? calendarTambahan.getEvents(mulai, selesai) : [];
      for (var i = 0; i < e1.length; i++) hasil.push(e1[i]);
      for (var i = 0; i < e2.length; i++) hasil.push(e2[i]);
      return hasil;
    }

    // Helper: Title Case
    function toTitleCase(str) {
      return str.toLowerCase().replace(/\b\w/g, function(c) { return c.toUpperCase(); });
    }

    // ============================================================
    // FITUR HAPUS AGENDA
    // "hapus agenda rapat", "hapus jadwal jam 10.00", "hapus bukber"
    // ============================================================
    if (pesanMasuk.includes("hapus")) {
      var now = new Date();
      var hariIniAwal = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      var hariIniAkhir = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

      // Cek apakah ada jam spesifik
      var matchJamHapus = pesanMasuk.match(/\d{1,2}[.:]\d{2}/);
      var eventsDihapus = [];

      if (matchJamHapus) {
        // Hapus berdasarkan jam
        var jamStr = matchJamHapus[0].replace('.', ':').split(':');
        var targetMulai = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(jamStr[0]), parseInt(jamStr[1]), 0);
        var targetSelesai = new Date(targetMulai.getTime() + 60000); // toleransi 1 menit
        var kandidat = getEventsGabunganRange(targetMulai, targetSelesai);
        for (var i = 0; i < kandidat.length; i++) eventsDihapus.push(kandidat[i]);
      } else {
        // Hapus berdasarkan nama — cari di hari ini
        var keyword = pesanMasuk
          .replace(/hapus\s*(agenda|jadwal|acara)?\s*/i, '')
          .trim();
        var semuaHariIni = getEventsGabunganRange(hariIniAwal, hariIniAkhir);
        for (var i = 0; i < semuaHariIni.length; i++) {
          if (semuaHariIni[i].getTitle().toLowerCase().includes(keyword)) {
            eventsDihapus.push(semuaHariIni[i]);
          }
        }
      }

      if (eventsDihapus.length === 0) {
        balasan = "🔍 Agenda yang mau dihapus tidak ketemu.\nCoba cek dulu dengan ketik *agenda hari ini* ya!";
      } else if (eventsDihapus.length === 1) {
        var judulHapus = eventsDihapus[0].getTitle();
        var jamHapus = Utilities.formatDate(eventsDihapus[0].getStartTime(), "Asia/Jakarta", "HH:mm");
        try {
          eventsDihapus[0].deleteEvent();
          balasan = "🗑️ *Agenda berhasil dihapus!*\n";
          balasan += "📌 " + judulHapus + "\n";
          balasan += "⏰ " + jamHapus;
        } catch(ex) {
          balasan = "❌ Gagal hapus, agenda ini mungkin dari kalender yang tidak bisa diedit.";
        }
      } else {
        // Lebih dari 1 ketemu, minta konfirmasi lebih spesifik
        balasan = "⚠️ Ketemu " + eventsDihapus.length + " agenda:\n";
        for (var i = 0; i < eventsDihapus.length; i++) {
          var jm = Utilities.formatDate(eventsDihapus[i].getStartTime(), "Asia/Jakarta", "HH:mm");
          balasan += (i+1) + ". " + eventsDihapus[i].getTitle() + " (" + jm + ")\n";
        }
        balasan += "\nCoba lebih spesifik, misal: *hapus agenda jam 10.00*";
      }
    }

    // ============================================================
    // FITUR 1: CEK AGENDA HARI INI / BESOK / TANGGAL TERTENTU
    // ============================================================
    else if (pesanMasuk.includes("agenda") || pesanMasuk.includes("jadwal")) {
      var tanggalCek;
      var labelWaktu;
      
      if (pesanMasuk.includes("besok")) {
        tanggalCek = new Date();
        tanggalCek.setDate(tanggalCek.getDate() + 1);
        labelWaktu = "Besok";
      } else if (pesanMasuk.includes("lusa")) {
        tanggalCek = new Date();
        tanggalCek.setDate(tanggalCek.getDate() + 2);
        labelWaktu = "Lusa";
      } else {
        var namaHariCek = {
          "minggu": 0, "senin": 1, "selasa": 2, "rabu": 3,
          "kamis": 4, "jumat": 5, "jum'at": 5, "sabtu": 6
        };
        var ketemu = false;
        for (var hari in namaHariCek) {
          if (pesanMasuk.includes(hari)) {
            var hariIni = new Date().getDay();
            var selisih = namaHariCek[hari] - hariIni;
            if (selisih <= 0) selisih += 7;
            tanggalCek = new Date();
            tanggalCek.setDate(tanggalCek.getDate() + selisih);
            var namaHariList = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
            labelWaktu = namaHariList[namaHariCek[hari]];
            ketemu = true;
            break;
          }
        }
        if (!ketemu) {
          tanggalCek = getTanggalDariPesan(pesanMasuk);
          var hariIniDate = new Date();
          hariIniDate.setHours(0,0,0,0);
          tanggalCek.setHours(0,0,0,0);
          if (tanggalCek.getTime() === hariIniDate.getTime()) {
            labelWaktu = "Hari Ini";
          } else {
            var namaHariList2 = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
            labelWaktu = namaHariList2[tanggalCek.getDay()] + ", " +
              Utilities.formatDate(tanggalCek, "Asia/Jakarta", "dd MMMM yyyy");
          }
        }
      }
      
      var events = getEventsGabungan(tanggalCek);
      if (events.length > 0) {
        balasan = "📅 *Agenda Dimas " + labelWaktu + ":*\n";
        for (var i = 0; i < events.length; i++) {
          var jamMulai = Utilities.formatDate(events[i].getStartTime(), "Asia/Jakarta", "HH:mm");
          var jamSelesai = Utilities.formatDate(events[i].getEndTime(), "Asia/Jakarta", "HH:mm");
          var lokasiEvent = events[i].getLocation() ? " 📍" + events[i].getLocation() : "";
          balasan += (i + 1) + ". *" + events[i].getTitle() + "*\n";
          balasan += "   ⏰ " + jamMulai + " - " + jamSelesai + lokasiEvent + "\n";
        }
      } else {
        balasan = "📅 *Agenda Dimas " + labelWaktu + ":*\nFree banget! Kalo ga bales berarti bobo/ngegame 😄";
      }
    }

    // ============================================================
    // FITUR 2A: SLOT KOSONG JAM BERAPA SAJA HARI INI
    // ============================================================
    else if (
      pesanMasuk.includes("kosong") && 
      (pesanMasuk.includes("jam berapa") || pesanMasuk.includes("kapan") || pesanMasuk.includes("waktu kosong"))
    ) {
      var now = new Date();
      var events = getEventsGabungan(now);
      
      if (events.length === 0) {
        balasan = "Hari ini Free Bangett!";
      } else {
        var slotSibuk = [];
        for (var i = 0; i < events.length; i++) {
          slotSibuk.push({
            mulai: events[i].getStartTime(),
            selesai: events[i].getEndTime(),
            judul: events[i].getTitle()
          });
        }
        slotSibuk.sort(function(a, b) { return a.mulai - b.mulai; });
        
        var jamAwal = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        var jamAkhir = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0);
        var slotKosong = [];
        var pointer = jamAwal;
        
        for (var i = 0; i < slotSibuk.length; i++) {
          if (pointer < slotSibuk[i].mulai) {
            slotKosong.push({ mulai: new Date(pointer), selesai: new Date(slotSibuk[i].mulai) });
          }
          if (slotSibuk[i].selesai > pointer) pointer = new Date(slotSibuk[i].selesai);
        }
        if (pointer < jamAkhir) slotKosong.push({ mulai: new Date(pointer), selesai: jamAkhir });
        
        slotKosong = slotKosong.filter(function(slot) {
          return (slot.selesai - slot.mulai) >= 30 * 60 * 1000;
        });
        
        if (slotKosong.length === 0) {
          balasan = "Hari ini lagi penuh banget nihh :(\nTidak ada slot kosong lebih dari 30 menit.";
        } else {
          balasan = "*Dimas hari ini kosong jam:*\n";
          for (var i = 0; i < slotKosong.length; i++) {
            var jm = Utilities.formatDate(slotKosong[i].mulai, "Asia/Jakarta", "HH:mm");
            var js = Utilities.formatDate(slotKosong[i].selesai, "Asia/Jakarta", "HH:mm");
            var durMenit = Math.round((slotKosong[i].selesai - slotKosong[i].mulai) / 60000);
            var durLabel = durMenit >= 60
              ? Math.floor(durMenit / 60) + " jam" + (durMenit % 60 > 0 ? " " + durMenit % 60 + " menit" : "")
              : durMenit + " menit";
            balasan += "✅ " + jm + " - " + js + " (" + durLabel + ")\n";
          }
        }
        
        balasan += "\n📌 *Acara Dimas hari ini:*\n";
        for (var i = 0; i < slotSibuk.length; i++) {
          var jm = Utilities.formatDate(slotSibuk[i].mulai, "Asia/Jakarta", "HH:mm");
          var js = Utilities.formatDate(slotSibuk[i].selesai, "Asia/Jakarta", "HH:mm");
          balasan += "• " + slotSibuk[i].judul + " (" + jm + " - " + js + ")\n";
        }
      }
    }

    // ============================================================
    // FITUR 2B: CEK APAKAH JAM TERTENTU KOSONG
    // ============================================================
    else if (
      (pesanMasuk.includes("kosong") || pesanMasuk.includes("ada acara") || pesanMasuk.includes("ada kegiatan")) &&
      pesanMasuk.match(/\d{1,2}[.:]\d{2}/)
    ) {
      var semuaJam = pesanMasuk.match(/\d{1,2}[.:]\d{2}/g);
      var now = new Date();
      var jamCekMulai, jamCekSelesai;
      
      if (semuaJam.length >= 2) {
        var j1 = semuaJam[0].replace('.', ':').split(':');
        var j2 = semuaJam[1].replace('.', ':').split(':');
        jamCekMulai = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(j1[0]), parseInt(j1[1]), 0);
        jamCekSelesai = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(j2[0]), parseInt(j2[1]), 0);
      } else {
        var j1 = semuaJam[0].replace('.', ':').split(':');
        jamCekMulai = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(j1[0]), parseInt(j1[1]), 0);
        jamCekSelesai = new Date(jamCekMulai.getTime() + 60 * 60 * 1000);
      }
      
      var eventsBentrok = getEventsGabunganRange(jamCekMulai, jamCekSelesai);
      var jamMulaiLabel = Utilities.formatDate(jamCekMulai, "Asia/Jakarta", "HH:mm");
      var jamSelesaiLabel = Utilities.formatDate(jamCekSelesai, "Asia/Jakarta", "HH:mm");
      
      if (eventsBentrok.length === 0) {
        balasan = "*Free!*\nJam " + jamMulaiLabel + " - " + jamSelesaiLabel + " ga ada acara";
      } else {
        balasan = "*Lagi ada acara nihh!*\nJam " + jamMulaiLabel + " - " + jamSelesaiLabel + ":\n";
        for (var i = 0; i < eventsBentrok.length; i++) {
          var jm = Utilities.formatDate(eventsBentrok[i].getStartTime(), "Asia/Jakarta", "HH:mm");
          var js = Utilities.formatDate(eventsBentrok[i].getEndTime(), "Asia/Jakarta", "HH:mm");
          balasan += "• " + eventsBentrok[i].getTitle() + " (" + jm + " - " + js + ")\n";
        }
        balasan += "Sorry yaa, mungkin ada waktu lain?\n";
      }
    }

    // ============================================================
    // FITUR 4: CATAT / REMINDER TEKS
    // ============================================================
    else if (pesanMasuk.includes("catat") || pesanMasuk.includes("ingatkan")) {
      var isiCatatan = pesanMasuk
        .replace(/^(catat|ingatkan aku|ingatkan)\s*/i, '')
        .trim();
      var today = new Date();
      var judulCatatan = "📝 " + toTitleCase(isiCatatan);
      calendarUtama.createAllDayEvent(judulCatatan, today);
      balasan = "📝 *Catatan tersimpan!*\n\n\"" + isiCatatan + "\"\n\nSudah Wolly catat di Google Calendar hari ini ya!";
    }

    // ============================================================
    // FITUR HELP
    // ============================================================
    else if (
      pesanMasuk.includes("help") ||
      pesanMasuk.includes("bantuan") ||
      pesanMasuk.includes("fitur") ||
      pesanMasuk.includes("bisa apa") ||
      pesanMasuk.includes("cara pakai")
    ) {
      balasan = "🤖 *Halo! Wolly by Dimas bisa:*\n\n";

      balasan += "📅 *CEK AGENDA*\n";
      balasan += "Contoh:\n";
      balasan += "• `agenda hari ini`\n";
      balasan += "• `agenda besok`\n";
      balasan += "• `jadwal jumat`\n";
      balasan += "• `agenda 25 april`\n\n";

      balasan += "🕐 *SLOT KOSONG*\n";
      balasan += "Contoh: `kosong jam berapa hari ini`\n\n";

      balasan += "🔍 *CEK JAM TERTENTU*\n";
      balasan += "Contoh: `jam 10.00 sampai 12.00 kosong ga`\n\n";

      balasan += "➕ *CATAT JADWAL*\n";
      balasan += "Format: _[kegiatan] [hari/tanggal] jam [mulai]-[selesai] di [lokasi] warna [warna]_\n";
      balasan += "Contoh:\n";
      balasan += "• `bukber jumat jam 17.00-20.00 di kampus`\n";
      balasan += "• `besok rapat jam 09.00-11.00 warna merah`\n";
      balasan += "• `25 april kondangan jam 10.00 warna hijau`\n";
      balasan += "• `kumpul jam 19.00` _(default warna biru)_\n\n";

      balasan += "🗑️ *HAPUS AGENDA*\n";
      balasan += "Contoh:\n";
      balasan += "• `hapus agenda rapat`\n";
      balasan += "• `hapus jadwal jam 10.00`\n\n";

      balasan += "📝 *CATATAN CEPAT*\n";
      balasan += "Contoh: `catat beli martabak sebelum otw`\n\n";

      balasan += "🎨 *Pilihan warna:*\n";
      balasan += "merah, pink, kuning, hijau, tosca, biru, biru tua, abu\n\n";

      balasan += "💡 Format jam: `17.00` atau `17:00`\n";
      balasan += "Btw kalo nambahin jadwal bilang ke Dimas yaa 😄";
    }

    // ============================================================
    // FITUR 3: TAMBAH JADWAL + WARNA + SUPPORT HARI/TANGGAL
    // ============================================================
    else {
      var regexRange = /(\d{1,2}[.:]\d{2})\s*[-–]\s*(\d{1,2}[.:]\d{2})/;
      var regexSampai = /(\d{1,2}[.:]\d{2})\s*(?:sampai|hingga|s\/d)\s*(\d{1,2}[.:]\d{2})/i;
      var regexSingle = /(\d{1,2}[.:]\d{2})/;
      
      var matchRange = pesanMasuk.match(regexRange) || pesanMasuk.match(regexSampai);
      var matchSingle = pesanMasuk.match(regexSingle);
      
      if (matchSingle) {
        var jamMulaiStr, jamSelesaiStr;
        var adaJamSelesai = false;
        
        if (matchRange) {
          jamMulaiStr = matchRange[1].replace('.', ':');
          jamSelesaiStr = matchRange[2].replace('.', ':');
          adaJamSelesai = true;
        } else {
          jamMulaiStr = matchSingle[1].replace('.', ':');
        }
        
        // Deteksi warna
        var warnaMap = {
          "merah":    CalendarApp.EventColor.RED,
          "pink":     CalendarApp.EventColor.PINK,
          "kuning":   CalendarApp.EventColor.YELLOW,
          "hijau":    CalendarApp.EventColor.GREEN,
          "tosca":    CalendarApp.EventColor.TEAL,
          "biru tua": CalendarApp.EventColor.DARK_BLUE,
          "biru":     CalendarApp.EventColor.BLUE,
          "abu":      CalendarApp.EventColor.GRAY
        };
        var warnaEvent = CalendarApp.EventColor.BLUE; // default biru
        var warnaNama = "Biru";
        for (var w in warnaMap) {
          if (pesanMasuk.includes(w)) {
            warnaEvent = warnaMap[w];
            warnaNama = toTitleCase(w);
            break;
          }
        }

        // Ambil judul — hapus jam, hari, tanggal, warna, kata kunci
        var judul = pesanMasuk
          .replace(regexRange, '')
          .replace(regexSampai, '')
          .replace(regexSingle, '')
          .replace(/\bjam\b/gi, '')
          .replace(/\bwarna\s+\w+(\s+\w+)?\b/gi, '')
          .replace(/\b(besok|lusa|hari ini|senin|selasa|rabu|kamis|jumat|jum'at|sabtu|minggu)\b/gi, '')
          .replace(/\btanggal\s+\d{1,2}\b/gi, '')
          .replace(/\d{1,2}\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)(\s+\d{4})?/gi, '')
          .replace(/\d{1,2}[\/\-]\d{1,2}([\/\-]\d{4})?/g, '')
          .trim();
        
        // Ambil lokasi
        var lokasi = "";
        var matchLokasi = judul.match(/\bdi\s+(.+)$/i);
        if (matchLokasi) {
          lokasi = toTitleCase(matchLokasi[1].trim());
          judul = judul.replace(/\bdi\s+.+$/i, '').trim();
        }
        
        // Title Case untuk judul
        judul = judul === "" ? "Agenda" : toTitleCase(judul);
        
        var tanggal = getTanggalDariPesan(pesanMasuk);
        var jM = jamMulaiStr.split(':');
        var waktuMulai = new Date(tanggal.getFullYear(), tanggal.getMonth(), tanggal.getDate(), parseInt(jM[0]), parseInt(jM[1]), 0);
        
        var waktuSelesai;
        if (adaJamSelesai) {
          var jS = jamSelesaiStr.split(':');
          waktuSelesai = new Date(tanggal.getFullYear(), tanggal.getMonth(), tanggal.getDate(), parseInt(jS[0]), parseInt(jS[1]), 0);
          if (waktuSelesai <= waktuMulai) waktuSelesai.setDate(waktuSelesai.getDate() + 1);
        } else {
          waktuSelesai = new Date(waktuMulai.getTime() + 60 * 60 * 1000);
          jamSelesaiStr = Utilities.formatDate(waktuSelesai, "Asia/Jakarta", "HH:mm");
        }
        
        var namaHariList = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
        var labelTanggal = namaHariList[tanggal.getDay()] + ", " +
          Utilities.formatDate(tanggal, "Asia/Jakarta", "dd MMMM yyyy");
        
        // Simpan ke kalender UTAMA saja
        var event = calendarUtama.createEvent(judul, waktuMulai, waktuSelesai);
        if (lokasi !== "") event.setLocation(lokasi);
        event.setColor(warnaEvent);
        event.addPopupReminder(30);
        event.addEmailReminder(30);
        
        // Notif ke nomor pribadi
        var nomorPribadi = "6281325814635";
        var pesanNotif = "🔔 *Jadwal Baru Masuk!*\n";
        pesanNotif += "📌 " + judul + "\n";
        pesanNotif += "📆 " + labelTanggal + "\n";
        pesanNotif += "⏰ " + jamMulaiStr + " - " + jamSelesaiStr + "\n";
        if (lokasi !== "") pesanNotif += "📍 " + lokasi + "\n";
        pesanNotif += "🎨 " + warnaNama;
        kirimWA(token, nomorPribadi, pesanNotif);
        
        balasan = "✅ *Berhasil Dicatat!*\n";
        balasan += "📌 " + judul + "\n";
        balasan += "📆 " + labelTanggal + "\n";
        balasan += "⏰ " + jamMulaiStr + " - " + jamSelesaiStr + "\n";
        if (lokasi !== "") balasan += "📍 " + lokasi + "\n";
        balasan += "🎨 " + warnaNama + "\n";
        balasan += "🔔 Wolly pasti take reminder 30 menit sebelum acara ke Dimas\n\n";
        balasan += "Terimakasihh :)";
      }
    }

    // Fallback
    if (balasan === "") {
      balasan = "Halo! Wolly bingung nih sama pesanmuu\nCoba ketik *help* buat lihat fitur Wolly ya!";
    }

    if (balasan !== "" && sender !== "") {
      kirimWA(token, sender, balasan);
    }

  } catch (err) {
    var errorMsg = "🔴 Error: " + err.message;
    if (senderBackup !== "") kirimWA(token, senderBackup, errorMsg);
    console.log("ERROR: " + err.message + "\n" + err.stack);
  }
}

// ============================================================
// HELPER: Parse hari/tanggal dari pesan
// ============================================================
function getTanggalDariPesan(pesan) {
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  if (pesan.includes("besok")) {
    var d = new Date(today); d.setDate(d.getDate() + 1); return d;
  }
  if (pesan.includes("lusa")) {
    var d = new Date(today); d.setDate(d.getDate() + 2); return d;
  }
  
  var namaHari = {
    "minggu": 0, "senin": 1, "selasa": 2, "rabu": 3,
    "kamis": 4, "jumat": 5, "jum'at": 5, "sabtu": 6
  };
  for (var hari in namaHari) {
    if (pesan.includes(hari)) {
      var targetHari = namaHari[hari];
      var hariIni = today.getDay();
      var selisih = targetHari - hariIni;
      if (selisih <= 0) selisih += 7;
      var d = new Date(today); d.setDate(d.getDate() + selisih); return d;
    }
  }
  
  var bulanMap = {
    "januari":0,"februari":1,"maret":2,"april":3,"mei":4,"juni":5,
    "juli":6,"agustus":7,"september":8,"oktober":9,"november":10,"desember":11
  };
  for (var bln in bulanMap) {
    var re = new RegExp("(\\d{1,2})\\s+" + bln + "(?:\\s+(\\d{4}))?");
    var m = pesan.match(re);
    if (m) {
      var thn = m[2] ? parseInt(m[2]) : now.getFullYear();
      return new Date(thn, bulanMap[bln], parseInt(m[1]));
    }
  }
  
  var mTgl = pesan.match(/tanggal\s+(\d{1,2})/);
  if (mTgl) {
    var tgl = parseInt(mTgl[1]);
    var d = new Date(today.getFullYear(), today.getMonth(), tgl);
    if (d < today) d.setMonth(d.getMonth() + 1);
    return d;
  }
  
  var mSlash = pesan.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?/);
  if (mSlash) {
    var thn = mSlash[3] ? parseInt(mSlash[3]) : now.getFullYear();
    return new Date(thn, parseInt(mSlash[2]) - 1, parseInt(mSlash[1]));
  }
  
  return today;
}

// ============================================================
// HELPER: Kirim WA via Fonnte
// ============================================================
function kirimWA(token, target, message) {
  UrlFetchApp.fetch("https://api.fonnte.com/send", {
    "method": "post",
    "headers": { "Authorization": token },
    "payload": { "target": target, "message": message }
  });
}

// ============================================================
// TEST FUNCTION
// ============================================================
function testKirim() {
  var response = UrlFetchApp.fetch("https://api.fonnte.com/send", {
    "method": "post",
    "headers": { "Authorization": "y8r69Mn9yQgmedxDfNP2" },
    "payload": {
      "target": "6282326142237",
      "message": "test berhasil!"
    }
  });
  console.log(response.getContentText());
}

// ============================================================
// GET: Cek event untuk ESP32
// ============================================================
function doGet(e) {
  var action = e.parameter.action;
  if (action === "cekMochi") {
    var calendar = CalendarApp.getCalendarById("dimasrizkia477@gmail.com");
    var now = new Date();
    var satuJamLagi = new Date(now.getTime() + (60 * 60 * 1000));
    var events = calendar.getEvents(now, satuJamLagi);
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