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

console.log("Measuring Slow (formatter recreated per call)...");
console.time("Slow");
for (let i = 0; i < N; i++) {
  formatDateSlow(testDate);
}
console.timeEnd("Slow");

console.log("Measuring Fast (cached formatter, as used in App.tsx)...");
console.time("Fast");
for (let i = 0; i < N; i++) {
  formatDateFast(testDate);
}
console.timeEnd("Fast");
