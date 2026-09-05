import { api, client, configured, ConverterApiError } from "./converter-client";
import {
  API_VERSION,
  checkStatement,
  money,
  pence,
  spreadsheetText,
  type Statement,
} from "../../shared/statement";
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id)! as T;
let epoch = 0,
  navigation = 0,
  edits = 0,
  accountRequest = 0,
  saving = false;
let active: any = null,
  draft: Statement | null = null,
  dirty = false,
  sourceUrl = "",
  timer: number | undefined,
  expiryTimer: number | undefined;
const error = (e: unknown) => {
  if (e instanceof ConverterApiError && e.code === "ALLOWANCE") {
    stage("quota");
    return;
  }
  $("error").textContent = e instanceof Error
    ? e.message
    : "Something went wrong. Please try again.";
  $("error").hidden = false;
};
const run = async (fn: () => Promise<void>) => {
  const started = epoch;
  $("error").hidden = true;
  try {
    await fn();
  } catch (e) {
    if (started === epoch) error(e);
  }
};
const stage = (id: string) => {
  const focused = document.activeElement;
  const hidingFocus = ["profile", "upload", "quota", "progress"].some(
    (name) => name !== id && $(name).contains(focused),
  );
  for (const name of ["profile", "upload", "quota", "progress"]) {
    $(name).hidden = name !== id;
  }
  if (hidingFocus) {
    $("work-title").tabIndex = -1;
    $("work-title").focus();
  }
};
function clearSource() {
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = "";
  $("source").removeAttribute("src");
  $("source-link").removeAttribute("href");
}
function clearReview() {
  navigation++;
  clearSource();
  clearTimeout(timer);
  clearTimeout(expiryTimer);
  active = null;
  draft = null;
  dirty = false;
  saving = false;
  $("review").hidden = true;
  $("rows").replaceChildren();
  $("next-step").hidden = true;
}
function check() {
  if (!draft) return;
  const checks = checkStatement(draft);
  const title = document.createElement("strong");
  title.textContent = {
    matches: "Balance matches",
    mismatch: "Balance mismatch",
    unavailable: "Balance unavailable",
  }[checks.balance];
  const list = document.createElement("ul");
  for (const issue of checks.issues) {
    const li = document.createElement("li");
    li.textContent = `${
      issue.row !== undefined ? `Row ${issue.row + 1}: ` : ""
    }${issue.message}`;
    list.append(li);
  }
  $("checks").replaceChildren(title, list);
  $("ack-wrap").hidden = checks.balance !== "unavailable";
  $("xero").toggleAttribute(
    "disabled",
    dirty ||
      !checks.canExport ||
      (checks.balance === "unavailable" && !$<HTMLInputElement>("ack").checked),
  );
  $("excel").toggleAttribute("disabled", dirty);
  $("save").toggleAttribute("disabled", !dirty || saving);
}
function renderRows() {
  if (!draft) return;
  $("rows").replaceChildren();
  draft.transactions.forEach((t, i) => {
    const tr = document.createElement("tr");
    for (const key of ["date", "description", "amount"] as const) {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.value = key === "amount" ? money(t.amount) : t[key];
      input.setAttribute(
        "aria-label",
        `${key === "amount" ? "Amount in pounds" : key} for row ${i + 1}`,
      );
      input.type = key === "date" ? "date" : "text";
      if (key === "amount") input.inputMode = "decimal";
      if (key === "description") input.maxLength = 2000;
      input.addEventListener("input", () => {
        if (!draft) return;
        if (key === "amount") draft.transactions[i].amount = pence(input.value);
        else draft.transactions[i][key] = input.value;
        edits++;
        dirty = true;
        $("save-status").textContent = "Unsaved corrections";
        check();
      });
      td.append(input);
      tr.append(td);
    }
    const page = document.createElement("td");
    page.textContent = String(t.page);
    tr.append(page);
    $("rows").append(tr);
  });
  check();
}
async function account(autoOpen = true) {
  const started = epoch,
    request = ++accountRequest;
  const a = await api("account");
  if (started !== epoch || request !== accountRequest) return;
  $("signout").hidden = false;
  $("recent").hidden = !a.jobs.length;
  $("job-list").replaceChildren();
  for (const j of a.jobs) {
    const b = document.createElement("button");
    b.textContent = `${new Date(j.created_at).toLocaleDateString("en-GB")} · ${
      j.pages ?? "–"
    } pages · ${j.state === "review" ? "Ready to review" : j.state}`;
    b.onclick = () => void run(() => open(j.id));
    $("job-list").append(b);
  }
  if (!a.profile?.email) {
    stage("profile");
  } else {
    const pending = a.jobs.find((j: any) =>
      ["uploading", "queued", "processing"].includes(j.state)
    );
    if (pending && autoOpen) await open(pending.id);
    else if (!pending) stage(a.remaining > 0 ? "upload" : "quota");
  }
}
async function open(id: string, retry = 0) {
  if (dirty && !confirm("Discard your unsaved corrections?")) return;
  clearReview();
  const started = epoch,
    view = navigation;
  const current = () => started === epoch && view === navigation;
  let job;
  try {
    job = await api("get", { id });
  } catch (e) {
    if (!current()) return;
    if (retry < 3) {
      timer = window.setTimeout(
        () => void run(() => open(id, retry + 1)),
        3000 * (retry + 1),
      );
    } else {
      stage("upload");
      void run(() => account(false));
    }
    throw e;
  }
  if (!current()) return;
  active = job;
  expiryTimer = window.setTimeout(
    () => {
      clearReview();
      stage("upload");
      error(
        new Error(
          "This conversion has expired. Upload a new statement to continue.",
        ),
      );
      void run(() => account(false));
    },
    Math.max(0, Date.parse(job.expires_at) - Date.now()),
  );
  if (job.state === "review") {
    draft = structuredClone(job.content.corrected);
    $("review").hidden = false;
    $<HTMLInputElement>("ack").checked = false;
    $("save-status").textContent = "";
    $("expiry").textContent = `File and transactions expire ${
      new Date(
        job.expires_at,
      ).toLocaleString("en-GB")
    }.`;
    renderRows();
    await account(false);
    if (!current()) return;
    $("review-title").tabIndex = -1;
    $("review-title").focus({ preventScroll: true });
    $("review").scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
    const blob = await api("source", { id });
    if (!current()) return;
    sourceUrl = URL.createObjectURL(blob);
    $<HTMLIFrameElement>("source").src = sourceUrl;
    $<HTMLAnchorElement>("source-link").href = sourceUrl;
  } else if (job.state === "failed") {
    await account(false);
    if (current()) {
      error(
        new Error(
          "We couldn’t read this statement reliably. Your pages have been returned. Try a clearer PDF, or contact us for help.",
        ),
      );
    }
  } else if (["queued", "processing", "uploading"].includes(job.state)) {
    stage("progress");
    $("progress-text").textContent = job.state === "uploading"
      ? "Waiting for your PDF upload. Delete this conversion if the upload was interrupted."
      : `${job.next_page} of ${job.pages} pages prepared. This can take a few minutes.`;
    timer = window.setTimeout(() => void run(() => open(id)), 5000);
  }
}
function signedOut() {
  epoch++;
  accountRequest++;
  clearReview();
  $("recent").hidden = true;
  $("job-list").replaceChildren();
  $("signout").hidden = true;
  stage("profile");
}
$("signout").onclick = () =>
  void run(async () => {
    if (
      !confirm(
        "End this private session? You won’t be able to reopen its results afterward.",
      )
    ) return;
    signedOut();
    $<HTMLFormElement>("profile").reset();
    const { error: signoutError } = await client!.auth.signOut();
    if (signoutError) {
      $("signout").hidden = false;
      error(new Error("Ending the session could not be completed. Please retry."));
    }
  });
$<HTMLFormElement>("profile").onsubmit = (e) => {
  e.preventDefault();
  const form = e.currentTarget as HTMLFormElement;
  const button = form.querySelector<HTMLButtonElement>("button")!;
  if (button.disabled) return;
  const fields = Object.fromEntries(new FormData(form));
  button.disabled = true;
  void run(async () => {
    const started = epoch;
    try {
      const { data: { session } } = await client!.auth.getSession();
      if (!session) {
        const { error: sessionError } = await client!.auth.signInAnonymously();
        if (sessionError) {
          throw new Error(
            "We couldn’t start your private session. Please try again shortly.",
          );
        }
      }
      if (started !== epoch) return;
      await api("profile", fields);
      if (started === epoch) await account();
    } finally {
      button.disabled = false;
    }
  });
};
$<HTMLFormElement>("upload").onsubmit = (e) => {
  e.preventDefault();
  const file = $<HTMLInputElement>("pdf").files?.[0];
  if (!file) return;
  void run(async () => {
    if (file.size > 10485760) {
      throw new Error("Choose a PDF smaller than 10 MB.");
    }
    const started = epoch;
    clearReview();
    stage("progress");
    $("progress-text").textContent = "Uploading and checking your PDF…";
    $("cancel").hidden = true;
    try {
      const job = await api("create");
      if (started !== epoch) return;
      active = job;
      const result = await api("upload", {}, file, job.id);
      if (started !== epoch) return;
      await account(false);
      await open(result.id);
    } catch (e) {
      if (started !== epoch) return;
      await account().catch(() => stage("upload"));
      throw e;
    } finally {
      $("cancel").hidden = false;
      $<HTMLInputElement>("pdf").value = "";
    }
  });
};
for (const id of ["delete", "cancel"]) {
  $(id).onclick = () =>
    void run(async () => {
      if (!active || !confirm("Delete this statement and its transactions?")) {
        return;
      }
      await api("delete", { id: active.id });
      clearReview();
      await account();
    });
}
$("save").onclick = () =>
  void run(async () => {
    if (!draft || !active || saving) return;
    const started = epoch,
      id = active.id,
      view = navigation,
      submittedEdits = edits;
    saving = true;
    check();
    try {
      const result = await api("edit", {
        id,
        revision: active.revision,
        statement: structuredClone(draft),
      });
      if (started !== epoch || view !== navigation || active?.id !== id) return;
      active.revision = result.revision;
      dirty = edits !== submittedEdits;
      $("save-status").textContent = dirty
        ? "Newer corrections still need saving"
        : "Corrections saved";
    } finally {
      if (started === epoch && view === navigation) {
        saving = false;
        check();
      }
    }
  });
$("ack").onchange = check;
for (const view of ["rows", "source"]) {
  $("show-" + view).onclick = () => {
    $("review").classList.toggle("source-active", view === "source");
    $("show-rows").setAttribute("aria-pressed", String(view === "rows"));
    $("show-source").setAttribute("aria-pressed", String(view === "source"));
  };
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
for (const format of ["excel", "xero"]) {
  $(format).onclick = () =>
    void run(async () => {
      if (!active || dirty) return;
      const started = epoch,
        view = navigation;
      const result = await api("export", {
        id: active.id,
        revision: active.revision,
        format,
        acknowledged: $<HTMLInputElement>("ack").checked,
      });
      if (started !== epoch || view !== navigation) return;
      if (format === "xero") {
        if (result.files.length === 1) {
          download(
            new Blob([result.files[0]], { type: "text/csv;charset=utf-8" }),
            "xero-statement.csv",
          );
        } else {
          const { default: JSZip } = await import("jszip");
          const zip = new JSZip();
          result.files.forEach((file: string, i: number) =>
            zip.file(`xero-statement-${i + 1}.csv`, file)
          );
          const blob = await zip.generateAsync({ type: "blob" });
          if (started !== epoch || view !== navigation) return;
          download(blob, "xero-statements.zip");
        }
      } else {
        const { default: ExcelJS } = await import("exceljs");
        const book = new ExcelJS.Workbook();
        const tx = book.addWorksheet("Transactions");
        tx.columns = [
          { header: "Date", key: "date", width: 15 },
          { header: "Description", key: "description", width: 55 },
          { header: "Amount GBP", key: "amount", width: 18 },
          { header: "Running balance GBP", key: "balance", width: 22 },
          { header: "Source page", key: "page", width: 14 },
        ];
        for (const t of result.statement.transactions) {
          tx.addRow({
            date: spreadsheetText(t.date),
            description: spreadsheetText(t.description),
            amount: t.amount === null ? null : t.amount / 100,
            balance: t.balance === null ? null : t.balance / 100,
            page: t.page,
          });
        }
        tx.getColumn("amount").numFmt = "0.00";
        tx.getColumn("balance").numFmt = "0.00";
        tx.getRow(1).font = { bold: true };
        const checks = book.addWorksheet("Checks");
        checks.columns = [
          { header: "Check", width: 28 },
          {
            header: "Detail",
            width: 85,
          },
        ];
        checks.addRow(["Balance", result.checks.balance]);
        checks.addRow([
          "Review",
          "A matching balance does not prove every transaction is correct.",
        ]);
        for (const issue of result.checks.issues) {
          checks.addRow([
            issue.row === undefined ? "Statement" : `Row ${issue.row + 1}`,
            spreadsheetText(issue.message),
          ]);
        }
        const bytes = await book.xlsx.writeBuffer();
        if (started !== epoch || view !== navigation) return;
        download(
          new Blob([new Uint8Array(bytes)], {
            type:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
          "statement-review.xlsx",
        );
      }
      $("next-step").hidden = false;
    });
}
$("request-followup").onclick = () =>
  void run(async () => {
    if (!$<HTMLInputElement>("followup").checked) {
      throw new Error("Select the contact request checkbox first.");
    }
    const started = epoch;
    await api("followup");
    if (started !== epoch) return;
    $("followup-status").textContent =
      "Your request is saved. Our team will be in touch.";
    $("request-followup").toggleAttribute("disabled", true);
  });
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
client?.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    signedOut();
  }
});
void run(async () => {
  if (!configured) {
    $("availability").textContent =
      "We’re preparing this tool for launch. For now, talk to us about your statement workflow.";
    return;
  }
  const cap = await api("capabilities");
  if (!cap.enabled || cap.version !== API_VERSION || !cap.banks.length) {
    $("availability").textContent =
      "The converter is not available yet. Please check back soon.";
    return;
  }
  $("banks").textContent = `Available for ${
    cap.banks.join(", ")
  }. English GBP current accounts.`;
  const { data: { session } } = await client!.auth.getSession();
  if (session) {
    $("availability").hidden = true;
    await account();
    return;
  }
  $("availability").hidden = true;
  stage("profile");
});
