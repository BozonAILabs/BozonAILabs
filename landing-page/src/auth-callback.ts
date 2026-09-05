import { client } from "./converter-client";
const status = document.querySelector<HTMLElement>("#auth-status")!;
const params = new URLSearchParams(location.search);
if (!client || params.has("error")) {
  status.textContent =
    "Sign-in was cancelled or unavailable. Return to the converter to try again.";
} else {
  const code = params.get("code");
  if (!code) {
    status.textContent =
      "This sign-in link is incomplete. Please try signing in again.";
  } else {
    const { error } = await client.auth.exchangeCodeForSession(code);
    history.replaceState(null, "", location.pathname);
    if (error) {
      status.textContent =
        "This sign-in link has expired. Return to the converter to try again.";
    } else location.replace("/tools/bank-statement-converter");
  }
}
