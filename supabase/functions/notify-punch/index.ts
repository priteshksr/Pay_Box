// Supabase Edge Function: notify-punch
//
// Triggered by a Database Webhook on INSERT to `public.events` where
// kind is 'punch_in' or 'punch_out'. Sends a native push notification
// to all owner devices of the affected business via FCM HTTP v1 API.
//
// Required secrets (set via `supabase secrets set`):
//   SUPABASE_SERVICE_ROLE_KEY  — reads push_tokens, members, businesses
//   FIREBASE_SERVICE_ACCOUNT   — JSON string of the Firebase service account
//
// The webhook payload shape (Supabase Database Webhooks):
//   { type: "INSERT", table: "events", record: { id, business_id, author_id, staff_id, kind, payload, ... } }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: {
    id: number;
    business_id: string;
    author_id: string;
    staff_id: string;
    kind: string;
    payload: Record<string, unknown>;
    created_at: string;
  };
}

Deno.serve(async (req) => {
  try {
    // Webhook signature validation: reject unauthorized callers.
    const webhookSecret = Deno.env.get("WEBHOOK_SECRET");
    if (webhookSecret) {
      const sig = req.headers.get("x-supabase-webhook-signature") || "";
      if (sig !== webhookSecret) {
        return new Response("unauthorized", { status: 401 });
      }
    }

    const payload: WebhookPayload = await req.json();
    const event = payload.record;
    if (!event || !event.kind) {
      return new Response("no event", { status: 200 });
    }

    if (event.kind !== "punch_in" && event.kind !== "punch_out") {
      return new Response("ignored kind: " + event.kind, { status: 200 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const firebaseSAJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");

    if (!firebaseSAJson) {
      console.error("FIREBASE_SERVICE_ACCOUNT secret not set");
      return new Response("missing firebase config", { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Look up the staff name from the members table.
    const { data: member } = await supabase
      .from("members")
      .select("display_name")
      .eq("business_id", event.business_id)
      .eq("staff_id", event.staff_id)
      .eq("role", "worker")
      .limit(1)
      .single();

    const staffName = member?.display_name || event.staff_id;
    const isPunchIn = event.kind === "punch_in";
    const time = (event.payload as Record<string, string>)?.time || "";

    const title = isPunchIn ? "Punch In" : "Punch Out";
    const body = time
      ? `${staffName} punched ${isPunchIn ? "in" : "out"} at ${time}`
      : `${staffName} punched ${isPunchIn ? "in" : "out"}`;

    // Get all owner device tokens for this business.
    const { data: ownerMembers } = await supabase
      .from("members")
      .select("user_id")
      .eq("business_id", event.business_id)
      .eq("role", "owner");

    if (!ownerMembers?.length) {
      return new Response("no owners", { status: 200 });
    }

    const ownerIds = ownerMembers.map((m) => m.user_id);

    const { data: tokens } = await supabase
      .from("push_tokens")
      .select("token, platform")
      .eq("business_id", event.business_id)
      .in("user_id", ownerIds);

    if (!tokens?.length) {
      return new Response("no push tokens", { status: 200 });
    }

    // Get a short-lived OAuth2 access token for FCM v1 API.
    const accessToken = await getFCMAccessToken(firebaseSAJson);
    const sa = JSON.parse(firebaseSAJson);
    const projectId = sa.project_id;

    const results = await Promise.allSettled(
      tokens.map((t) =>
        sendFCM(projectId, accessToken, t.token, {
          title,
          body,
          data: { tab: "home", kind: event.kind, staffId: event.staff_id },
        })
      )
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    // Clean up any tokens that FCM rejected (unregistered / invalid).
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (
        r.status === "rejected" &&
        r.reason?.unregistered
      ) {
        await supabase
          .from("push_tokens")
          .delete()
          .eq("token", tokens[i].token);
      }
    }

    return new Response(
      JSON.stringify({ sent, failed, total: tokens.length }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("notify-punch error:", err);
    return new Response(String(err), { status: 500 });
  }
});

// --- FCM HTTP v1 helpers ------------------------------------------------

async function getFCMAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);

  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const claimSet = btoa(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  ).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const unsignedToken = `${header}.${claimSet}`;

  const pemKey = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const binaryKey = Uint8Array.from(atob(pemKey), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const jwt = `${unsignedToken}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth2 token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.access_token;
}

interface FCMMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

async function sendFCM(
  projectId: string,
  accessToken: string,
  deviceToken: string,
  msg: FCMMessage
): Promise<void> {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: {
            title: msg.title,
            body: msg.body,
          },
          data: msg.data || {},
          android: {
            priority: "high",
            notification: { sound: "default", channel_id: "paybox_punches" },
          },
          apns: {
            payload: {
              aps: { sound: "default", badge: 1 },
            },
          },
        },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    const unregistered =
      text.includes("UNREGISTERED") || text.includes("NOT_FOUND");
    const err: Error & { unregistered?: boolean } = new Error(
      `FCM send failed: ${res.status} ${text}`
    );
    err.unregistered = unregistered;
    throw err;
  }
}
