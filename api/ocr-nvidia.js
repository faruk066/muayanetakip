// Vercel sunucusuz fonksiyon: NVIDIA anahtarı istemciye inmez, tarayıcı CORS engeline takılmaz.
// İstemci aynı-origin "api/ocr-nvidia" adresine POST atar, bu fonksiyon NVIDIA'ya iletir.
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODEL = "meta/llama-3.2-11b-vision-instruct";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Yalnızca POST" });
    return;
  }
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    res.status(501).json({ error: "NVIDIA anahtarı sunucuda tanımlı değil" });
    return;
  }
  let image = null;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    image = body && body.image;
  } catch {
    image = null;
  }
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    res.status(400).json({ error: "Geçersiz görüntü" });
    return;
  }
  let upstream;
  try {
    upstream = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Transcribe the meter serial number digits visible in this image. Reply with digits only." },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
        max_tokens: 64,
        temperature: 0,
      }),
    });
  } catch {
    res.status(502).json({ error: "NVIDIA'ya ulaşılamadı" });
    return;
  }
  let payload = null;
  try {
    payload = await upstream.json();
  } catch {
    payload = null;
  }
  if (!upstream.ok) {
    res.status(502).json({ error: `NVIDIA ${upstream.status}` });
    return;
  }
  const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content
    : "";
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((p) => (p && typeof p.text === "string" ? p.text : "")).join(" ")
      : "";
  res.status(200).json({ text });
}
