import dotenv from 'dotenv';
dotenv.config();

export const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN || '';
export const HUBSPOT_API_VERSION = process.env.HUBSPOT_API_VERSION || '2026-03';
export const HUBSPOT_API_BASE_URL = 'https://api.hubapi.com';

export function validateHubSpotConfig(): boolean {
  if (!HUBSPOT_ACCESS_TOKEN) {
    return false;
  }
  return true;
}
