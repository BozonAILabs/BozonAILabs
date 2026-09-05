import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = !!url &&
  !!key &&
  import.meta.env.VITE_CONVERTER_ENABLED !== "false";
export const client = configured
  ? createClient(url, key, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
    },
  })
  : null;
export class ConverterApiError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(messages[code] ?? "We couldn’t complete that request. Please try again.");
    this.code = code;
  }
}
export async function api(
  action: string,
  body: unknown = {},
  file?: File,
  id?: string,
): Promise<any> {
  if (!client) throw new Error("The converter is not available yet.");
  const {
    data: { session },
  } = await client.auth.getSession();
  const response = await fetch(
    `${url}/functions/v1/converter-api?action=${action}${
      id ? "&id=" + encodeURIComponent(id) : ""
    }`,
    {
      method: "POST",
      headers: {
        apikey: key,
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        "Content-Type": file ? "application/pdf" : "application/json",
      },
      body: file ?? JSON.stringify(body),
    },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({
      error: "REQUEST_FAILED",
    }));
    throw new ConverterApiError(data.error);
  }
  return action === "source" ? response.blob() : response.json();
}
const messages: Record<string, string> = {
  SIGN_IN: "Your session has expired. Please enter your details to continue.",
  UNAVAILABLE: "The converter is not available yet.",
  INVALID_CONSENT: "Choose whether you want to share the statement with our team.",
  REVIEW_REQUIRED: "This result needs attention. Review the highlighted issues or request help before importing to Xero.",
  ALLOWANCE: "This statement exceeds your remaining free pages.",
  ACTIVE_JOB: "You already have a conversion running. Open it below.",
  RATE_LIMIT: "Too many uploads. Please try again in an hour.",
  PROFILE_REQUIRED: "Please enter your name, a valid email and practice name.",
  INVALID_PDF: "Choose a valid PDF bank statement.",
  INVALID_OR_ENCRYPTED_PDF:
    "We can’t open that PDF. Remove its password or upload a fresh copy.",
  PAGES: "Choose a PDF with 1 to 20 pages.",
  FILE_TOO_LARGE: "Choose a PDF smaller than 10 MB.",
  REVISION:
    "This conversion changed in another tab. Reopen it to get the latest version before editing.",
  EXPIRED: "This conversion has expired or been deleted.",
  NOT_FOUND: "This conversion is no longer available.",
  SOURCE_UNAVAILABLE: "The source PDF is unavailable.",
  STATE:
    "This conversion is no longer editable. Reopen it to check its status.",
};
