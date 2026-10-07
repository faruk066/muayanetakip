// Vercel sunucusuz fonksiyon: Evren LLM OCR API (dots-ocr, deepseek-ocr-2).
// İstemci aynı-origin "api/ocr-evren" adresine POST atar, bu fonksiyon Evren API'ye iletir.
const EVREN_URL = "https://evren-llmapi.ssyz.org.tr/v1/ocr";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Yalnızca POST" });
    return;
  }
  let body = null;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    body = null;
  }
  const apiKey =
    (body && typeof body.apiKey === "string" && body.apiKey.trim()) ||
    process.env.EVREN_API_KEY ||
    process.env.VITE_EVREN_API_KEY;

  if (!apiKey) {
    res.status(501).json({ error: "Evren API anahtarı tanımlı değil (EVREN_API_KEY)" });
    return;
  }
  const image = body && body.image;
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    res.status(400).json({ error: "Geçersiz görüntü" });
    return;
  }
  const model = body && body.model === "deepseek-ocr-2" ? "deepseek-ocr-2" : "dots-ocr";

  let upstream;
  try {
    upstream = await fetch(EVREN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        image,
      }),
    });
  } catch {
    res.status(502).json({ error: "Evren API'ye ulaşılamadı" });
    return;
  }

  let payload = null;
  try {
    payload = await upstream.json();
  } catch {
    payload = null;
  }

  if (!upstream.ok) {
    const errMsg =
      (payload && payload.error && payload.error.message) ||
      (payload && payload.message) ||
      `Evren API ${upstream.status}`;
    res.status(upstream.status || 502).json({ error: errMsg });
    return;
  }

  const text =
    typeof payload?.text === "string"
      ? payload.text
      : payload && typeof payload.output === "string"
        ? payload.output
        : "";
  res.status(200).json({ text });
}
