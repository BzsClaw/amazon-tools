export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "仅支持 POST 请求。" });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return response.status(500).json({ error: "服务端未配置 DEEPSEEK_API_KEY 环境变量。" });
  }

  const { model, temperature, messages } = request.body || {};

  if (!Array.isArray(messages) || !messages.length) {
    return response.status(400).json({ error: "请求缺少有效的 messages 参数。" });
  }

  const safeMessages = messages
    .filter((item) => item && (item.role === "system" || item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .map((item) => ({ role: item.role, content: item.content }));

  if (!safeMessages.length) {
    return response.status(400).json({ error: "messages 参数格式不正确。" });
  }

  const safeModel = typeof model === "string" && model.trim() ? model.trim() : "deepseek-chat";
  const safeTemperature = Number.isFinite(Number(temperature)) ? Number(temperature) : 0.4;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  try {
    const upstreamResponse = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: safeModel,
        temperature: safeTemperature,
        messages: safeMessages
      }),
      signal: controller.signal
    });

    const rawText = await upstreamResponse.text();
    let upstreamJson = null;

    try {
      upstreamJson = rawText ? JSON.parse(rawText) : null;
    } catch (error) {
      upstreamJson = null;
    }

    if (!upstreamResponse.ok) {
      const upstreamMessage = upstreamJson?.error?.message || rawText || `上游接口请求失败（${upstreamResponse.status}）`;
      return response.status(upstreamResponse.status).json({ error: upstreamMessage });
    }

    const content = upstreamJson?.choices?.[0]?.message?.content;
    if (!content) {
      return response.status(502).json({ error: "上游接口未返回可用内容。" });
    }

    return response.status(200).json({ content });
  } catch (error) {
    if (error?.name === "AbortError") {
      return response.status(504).json({ error: "请求超时，请稍后重试。" });
    }

    return response.status(500).json({ error: error?.message || "服务端请求失败。" });
  } finally {
    clearTimeout(timeoutId);
  }
}
