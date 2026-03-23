/**
 * TURICINE — Worker de captura de leads
 * Versión: 1.0
 * Deploy: wrangler deploy workers/leads.js
 *
 * CONFIGURACIÓN REQUERIDA en wrangler.toml:
 *   [[kv_namespaces]]
 *   binding = "LEADS_KV"
 *   id = "TU_KV_NAMESPACE_ID"
 *
 * OPCIONAL — reenvío por email con MailChannels (gratuito en Workers):
 *   Descomenta el bloque sendEmail() al final y completa los campos.
 *
 * ENDPOINTS:
 *   POST /leads   → guarda lead en KV, retorna JSON
 *   GET  /leads   → lista leads (requiere ?secret=ADMIN_SECRET en env)
 */

const CORS_ORIGIN = "https://turicine.com"; // cambia al dominio real

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return corsResponse(null, 204);
    }

    if (url.pathname === "/leads" && request.method === "POST") {
      return handleSubmit(request, env);
    }

    if (url.pathname === "/leads" && request.method === "GET") {
      return handleList(request, env);
    }

    return corsResponse(JSON.stringify({ error: "Not found" }), 404);
  },
};

// ─── POST /leads ─────────────────────────────────────────────────────────────
async function handleSubmit(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return corsResponse(JSON.stringify({ error: "JSON inválido" }), 400);
  }

  const { name, email, org, message, type } = body;

  if (!email || !email.includes("@")) {
    return corsResponse(JSON.stringify({ error: "Email requerido" }), 422);
  }

  const key = `lead:${Date.now()}:${email.replace(/[^a-z0-9]/gi, "_")}`;
  const lead = {
    name:    name    || "",
    email:   email,
    org:     org     || "",
    message: message || "",
    type:    type    || "contacto",   // "auspicio" | "voluntario" | "contacto"
    ts:      new Date().toISOString(),
    ip:      request.headers.get("CF-Connecting-IP") || "",
    country: request.headers.get("CF-IPCountry") || "",
  };

  await env.LEADS_KV.put(key, JSON.stringify(lead), {
    expirationTtl: 60 * 60 * 24 * 365, // 1 año
  });

  // Opcional: descomenta para reenviar por email vía MailChannels
  // await sendEmail(lead, env);

  return corsResponse(JSON.stringify({ ok: true, id: key }), 201);
}

// ─── GET /leads (admin) ───────────────────────────────────────────────────────
async function handleList(request, env) {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");

  if (!env.ADMIN_SECRET || secret !== env.ADMIN_SECRET) {
    return corsResponse(JSON.stringify({ error: "No autorizado" }), 401);
  }

  const list = await env.LEADS_KV.list({ prefix: "lead:" });
  const leads = await Promise.all(
    list.keys.map(async ({ name }) => {
      const val = await env.LEADS_KV.get(name);
      return val ? JSON.parse(val) : null;
    })
  );

  return corsResponse(JSON.stringify(leads.filter(Boolean)), 200);
}

// ─── Email via MailChannels (opcional) ───────────────────────────────────────
/*
async function sendEmail(lead, env) {
  await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: "turicine@gmail.com" }] }],
      from: { email: "leads@turicine.com", name: "TURICINE Leads" },
      subject: `Nuevo lead: ${lead.type} — ${lead.name || lead.email}`,
      content: [{
        type: "text/plain",
        value: `Nombre: ${lead.name}\nEmail: ${lead.email}\nOrganización: ${lead.org}\nTipo: ${lead.type}\nMensaje: ${lead.message}\nFecha: ${lead.ts}`,
      }],
    }),
  });
}
*/

// ─── Helper CORS ──────────────────────────────────────────────────────────────
function corsResponse(body, status = 200) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*", // restringe a CORS_ORIGIN en producción
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  return new Response(body, { status, headers });
}
