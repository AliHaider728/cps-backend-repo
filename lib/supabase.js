import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const SUPABASE_UPLOAD_BUCKET = "uploads";

let supabase;
let bucketReadyPromise;

function getSupabaseUrl() {
  const value = process.env.SUPABASE_URL;
  if (!value) throw new Error("SUPABASE_URL is not configured");
  return value;
}

function getSupabaseAnonKey() {
  const value = process.env.SUPABASE_ANON_KEY;
  if (!value) throw new Error("SUPABASE_ANON_KEY is not configured");
  return value;
}

export function getSupabaseClient() {
  if (!supabase) {
    supabase = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabase;
}

async function ensureUploadBucket() {
  if (!bucketReadyPromise) {
    bucketReadyPromise = (async () => {
      const client = getSupabaseClient();
      const { data: existing, error: lookupError } = await client.storage.getBucket(SUPABASE_UPLOAD_BUCKET);
      if (existing && !lookupError) return existing;

      const { data, error } = await client.storage.createBucket(SUPABASE_UPLOAD_BUCKET, {
        public: true,
      });

      if (error && !String(error.message || "").toLowerCase().includes("already exists")) {
        throw new Error(`Supabase storage bucket setup failed: ${error.message}`);
      }

      return data;
    })().catch((err) => {
      bucketReadyPromise = null;
      throw err;
    });
  }

  return bucketReadyPromise;
}

export async function uploadBufferToStorage({ buffer, contentType, fileName }) {
  const client = getSupabaseClient();
  await ensureUploadBucket();
  const filePath = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${fileName}`;
  const { error } = await client.storage
    .from(SUPABASE_UPLOAD_BUCKET)
    .upload(filePath, buffer, {
      contentType: contentType || "application/octet-stream",
      upsert: false,
    });

  if (error) {
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
