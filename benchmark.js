const trTRFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDateFast(date) {
  if (!date) return "Tarih yok";
  return trTRFormatter.format(new Date(date));
}

function formatDateSlow(date) {
  if (!date) return "Tarih yok";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

const N = 100000;
const testDate = new Date().toISOString();

<<<<<<< HEAD
console.log("Measuring Slow (current implementation)...");
=======
console.log("Measuring Slow (formatter recreated per call)...");
>>>>>>> 3b398a0 (Tum denetim bulgulari duzeltildi: exportler, cn util, PWA yollari, SW hardening, exceljs, test birlestirme)
console.time("Slow");
for (let i = 0; i < N; i++) {
  formatDateSlow(testDate);
}
console.timeEnd("Slow");

<<<<<<< HEAD
console.log("Measuring Fast (cached implementation)...");
=======
console.log("Measuring Fast (cached formatter, as used in App.tsx)...");
>>>>>>> 3b398a0 (Tum denetim bulgulari duzeltildi: exportler, cn util, PWA yollari, SW hardening, exceljs, test birlestirme)
console.time("Fast");
for (let i = 0; i < N; i++) {
  formatDateFast(testDate);
}
console.timeEnd("Fast");
