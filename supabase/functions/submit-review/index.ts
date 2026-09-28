// BHUMI SURVEY - Supabase Edge Function: submit-review
// Reviews are automatically approved after spam/security checks.
//
// Deploy:
// npx supabase functions deploy submit-review --project-ref kbtqrmqabasitsvhvwfy --use-api
//
// Secret:
// npx supabase secrets set RATE_LIMIT_SALT="LONG_RANDOM_SECRET" --project-ref kbtqrmqabasitsvhvwfy

import { createClient } from "npm:@supabase/supabase-js@2";

const defaultOrigin = "https://bhumi-survey.vercel.app";

const allowedOrigins = new Set([
  defaultOrigin,
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

function cors(origin: string) {
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin)
      ? origin
      : defaultOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };
}

function reply(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: cors(origin)
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return Array.from(new Uint8Array(digest))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || defaultOrigin;

  // Handle browser CORS preflight.
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: cors(origin)
    });
  }

  // Only POST is allowed.
  if (req.method !== "POST") {
    return reply(
      { error: "Method not allowed." },
      405,
      origin
    );
  }

  // Only approved website origins are allowed.
  if (!allowedOrigins.has(origin)) {
    return reply(
      { error: "Origin not allowed." },
      403,
      origin
    );
  }

  const body = await req.json().catch(() => null);

  if (!body) {
    return reply(
      { error: "Invalid request." },
      400,
      origin
    );
  }

  const name = String(body.name ?? "").trim();
  const project = String(body.project ?? "").trim();
  const message = String(body.message ?? "").trim();
  const rating = Number(body.rating);
  const honeypot = String(body.website ?? "").trim();

  // Honeypot spam protection.
  if (honeypot) {
    return reply({ ok: true }, 200, origin);
  }

  // Name validation.
  if (name.length < 2 || name.length > 80) {
    return reply(
      { error: "Please enter a valid name." },
      400,
      origin
    );
  }

  // Project/location validation.
  if (project.length > 120) {
    return reply(
      { error: "Project/location is too long." },
      400,
      origin
    );
  }

  // Rating validation.
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return reply(
      { error: "Rating must be between 1 and 5." },
      400,
      origin
    );
  }

  // Review message validation.
  if (message.length < 10 || message.length > 1200) {
    return reply(
      {
        error:
          "Review must be between 10 and 1200 characters."
      },
      400,
      origin
    );
  }

  // Basic link/spam protection.
  const urlCount =
    (message.match(/https?:\/\//gi) || []).length;

  if (urlCount > 1) {
    return reply(
      { error: "Please remove links from your review." },
      400,
      origin
    );
  }

  // Get visitor IP.
  const ip =
    req.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      ?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";

  // Hash IP instead of storing the raw IP.
  const salt = Deno.env.get("RATE_LIMIT_SALT") || "";

  const ipHash = await sha256(
    `${salt}:${ip}`
  );

  // Create duplicate-detection hash.
  const contentHash = await sha256(
    `${name.toLowerCase()}|${project.toLowerCase()}|${message.toLowerCase()}`
  );

  // Server-side Supabase client.
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ---------------------------------------------------------
  // RATE LIMIT
  // Maximum 3 submissions per IP hash per rolling hour.
  // ---------------------------------------------------------

  const { data: limit } = await db
    .from("review_rate_limits")
    .select("window_started_at,submissions")
    .eq("key", ipHash)
    .maybeSingle();

  const now = Date.now();

  if (limit) {
    const age =
      now -
      new Date(limit.window_started_at).getTime();

    if (
      age < 60 * 60 * 1000 &&
      Number(limit.submissions) >= 3
    ) {
      return reply(
        {
          error:
            "Too many review submissions. Please try again later."
        },
        429,
        origin
      );
    }

    if (age >= 60 * 60 * 1000) {
      await db
        .from("review_rate_limits")
        .update({
          window_started_at:
            new Date().toISOString(),
          submissions: 1
        })
        .eq("key", ipHash);
    } else {
      await db
        .from("review_rate_limits")
        .update({
          submissions:
            Number(limit.submissions) + 1
        })
        .eq("key", ipHash);
    }
  } else {
    await db
      .from("review_rate_limits")
      .insert({
        key: ipHash,
        window_started_at:
          new Date().toISOString(),
        submissions: 1
      });
  }

  // ---------------------------------------------------------
  // DUPLICATE REVIEW PROTECTION
  // ---------------------------------------------------------

  const { data: duplicate } = await db
    .from("reviews")
    .select("id")
    .eq("content_hash", contentHash)
    .limit(1)
    .maybeSingle();

  if (duplicate) {
    return reply(
      {
        error:
          "This review has already been submitted."
      },
      409,
      origin
    );
  }

  // ---------------------------------------------------------
  // SAVE REVIEW
  //
  // IMPORTANT:
  // status = "approved"
  //
  // This means no administrator approval is required.
  // ---------------------------------------------------------

  const { error } = await db
    .from("reviews")
    .insert({
      name,
      project: project || null,
      rating,
      message,

      // Automatically publish the review.
      status: "approved",

      // Record approval time automatically.
      approved_at: new Date().toISOString(),

      // No admin user approved it.
      approved_by: null,

      ip_hash: ipHash,
      content_hash: contentHash
    });

  if (error) {
    console.error(error);

    return reply(
      { error: "Could not save the review." },
      500,
      origin
    );
  }

  // ---------------------------------------------------------
  // SUCCESS
  // ---------------------------------------------------------

  return reply(
    {
      ok: true,
      message:
        "Review published successfully."
    },
    201,
    origin
  );
});