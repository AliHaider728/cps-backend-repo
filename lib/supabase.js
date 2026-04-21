import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const SUPABASE_UPLOAD_BUCKET = "uploads";

function getSupabaseUrl() {
  const value = process.env.SUPABASE_URL;
  if (!value) throw new Error("SUPABASE_URL is not configured");
  return value;
}

function getSupabaseKey() {
  // Service role key required for storage uploads
  // Falls back to anon key if service role not set
  const value =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY;
  if (!value) throw new Error("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY is not configured");
  return value;
}

export function getSupabaseClient() {
  if (!globalThis.__cpsSupabaseClient) {
    globalThis.__cpsSupabaseClient = createClient(getSupabaseUrl(), getSupabaseKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return globalThis.__cpsSupabaseClient;
}

export async function uploadBufferToStorage({ buffer, contentType, fileName }) {
  const client = getSupabaseClient();

  // Sanitize filename — remove spaces and special chars
  const safeName = (fileName || "upload.bin")
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .slice(0, 100);

  const filePath = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`;

  const { error } = await client.storage
    .from(SUPABASE_UPLOAD_BUCKET)
    .upload(filePath, buffer, {
      contentType: contentType || "application/octet-stream",
      upsert: false,
    });

  if (error) {
    console.error("Supabase upload error:", error);
    throw new Error(`Supabase storage upload failed: ${error.message}`);
  }

  const { data } = client.storage
    .from(SUPABASE_UPLOAD_BUCKET)
    .getPublicUrl(filePath);

  return {
    bucket: SUPABASE_UPLOAD_BUCKET,
    path: filePath,
    publicUrl: data.publicUrl,
  };
}