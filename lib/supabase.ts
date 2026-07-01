import dotenv from "dotenv";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

dotenv.config();

const SUPABASE_UPLOAD_BUCKET: string = "uploads";

function getSupabaseUrl(): string {
  const value = process.env.SUPABASE_URL;
  if (!value) throw new Error("SUPABASE_URL is not configured");
  return value;
}

function getSupabaseKey(): string {
  // Service role key required for storage uploads
  // Falls back to anon key if service role not set
  const value =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY;
  if (!value) throw new Error("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY is not configured");
  return value;
}

export function getSupabaseClient(): SupabaseClient {
  const globalAny = globalThis as any;
  if (!globalAny.__cpsSupabaseClient) {
    globalAny.__cpsSupabaseClient = createClient(getSupabaseUrl(), getSupabaseKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return globalAny.__cpsSupabaseClient;
}

export interface UploadOptions {
  buffer: Buffer;
  contentType?: string;
  fileName?: string;
}

export interface UploadResult {
  bucket: string;
  path: string;
  publicUrl: string;
}

export async function uploadBufferToStorage({ buffer, contentType, fileName }: UploadOptions): Promise<UploadResult> {
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
