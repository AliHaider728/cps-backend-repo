import axios, { AxiosInstance, AxiosError } from 'axios';
import { HUBSPOT_ACCESS_TOKEN, HUBSPOT_API_BASE_URL } from './hubspot.config.js';

const MAX_RETRIES = 3;

class HubSpotClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: HUBSPOT_API_BASE_URL,
      headers: {
        Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const config: any = error.config;
        if (!config) throw this.sanitizeError(error);

        config.retryCount = config.retryCount || 0;

        const status = error.response?.status;
        const isRetryable = status === 429 || (status && status >= 500 && status < 600) || !status;

        if (isRetryable && config.retryCount < MAX_RETRIES) {
          config.retryCount += 1;
          
          let delayMs = Math.pow(2, config.retryCount) * 1000 + Math.random() * 1000;
          
          if (status === 429 && error.response?.headers && error.response.headers['retry-after']) {
            const retryAfter = parseInt(error.response.headers['retry-after'], 10);
            if (!isNaN(retryAfter)) {
              delayMs = Math.max(delayMs, retryAfter * 1000);
            }
          }

          console.warn(`[HubSpot Client] Retryable error ${status || 'Network'}. Retrying attempt ${config.retryCount} in ${Math.round(delayMs)}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          return this.client.request(config);
        }

        throw this.sanitizeError(error);
      }
    );
  }

  private sanitizeError(error: AxiosError) {
    if (error.config && error.config.headers) {
      delete error.config.headers['Authorization'];
    }
    if (error.request) {
      // Remove any sensitive headers from request if attached
      delete error.request.headers;
    }

    const status = error.response?.status;
    let dataStr = '';
    try {
      dataStr = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    } catch {
      dataStr = 'Unparsable error data';
    }

    const sanitizedError = new Error(`HubSpot API Error: ${status || 'Network'} - ${dataStr}`);
    (sanitizedError as any).status = status;
    (sanitizedError as any).code = error.code;
    (sanitizedError as any).headers = error.response?.headers;
    return sanitizedError;
  }

  public async get(path: string, params?: any) {
    return this.client.get(path, { params });
  }

  public async post(path: string, data: any) {
    return this.client.post(path, data);
  }

  public async patch(path: string, data: any) {
    return this.client.patch(path, data);
  }

  public async put(path: string, data: any) {
    return this.client.put(path, data);
  }
}

export const hubspotClient = new HubSpotClient();
