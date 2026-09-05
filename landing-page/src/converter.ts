import { api, client, configured, ConverterApiError } from "./converter-client";
import {
  API_VERSION,
  isIncomplete,
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
  saving = false,
  exporting = false,
  remainingPages = 0;
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
  const hidingFocus = ["profile", "upload", "quota", "progress", "completed", "failed"].some(
    (name) => name !== id && $(name).contains(focused),
  );
  for (const name of ["profile", "upload", "quota", "progress", "completed", "failed"]) {
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
  exporting = false;
  $("review").hidden = true;
  $("rows").replaceChildren();
  $("workflow-contact").hidden = true;
  $("completed").hidden = true;
  $("failed").hidden = true;
}
function missingDetails(statement: Statement, includeFallback: boolean): string[] {
  const details: string[] = [];
  const identifiedPages = new Set<number>();
  statement.transactions.forEach((row, index) => {
    const fields = [
      !row.date.trim() ? "date" : "",
      !row.description.trim() ? "description" : "",
      row.amount === null ? "amount" : "",
    ].filter(Boolean);
    if (!fields.length) return;
    const missing = fields.length > 1
      ? `${fields.slice(0, -1).join(", ")} and ${fields.at(-1)}`
      : fields[0];
    details.push(`Row ${index + 1} (page ${row.page}): ${missing} missing.`);
    identifiedPages.add(row.page);
  });
  const unreadable = new Set(statement.extraction?.unreadablePages ?? []);
  for (const page of [...unreadable].sort((a, b) => a - b)) {
    details.push(`Page ${page}: could not be read. Transactions may be missing.`);
  }
  for (const page of [...new Set(statement.extraction?.uncertainPages ?? [])].sort((a, b) => a - b)) {
    if (!unreadable.has(page) && !identifiedPages.has(page)) {
      details.push(`Page ${page}: the extractor could not read all details confidently.`);
    }
  }
  if (!details.length && includeFallback && isIncomplete(statement)) {
    details.push("The extractor reported missing details but did not identify a row or page.");
  }
  return details;
}

function check() {
  if (!draft) return;
  const partial = isIncomplete(draft);
  const inProgress = ["queued", "processing", "uploading"].includes(active?.state);
  $("result-status").textContent = inProgress
    ? "Extraction still in progress. You can download the results available so far."
    : partial
    ? "Extraction completed."
    : "Extraction completed. Your transactions are ready to download.";
  $("completed-title").textContent = "Extraction completed";
  $("completed-message").hidden = partial;
  $("completed-message").textContent = "Your transactions are ready to download.";
  const details = missingDetails(draft, !inProgress);
  for (const id of ["completed-details", "result-details"]) {
    const list = $(id);
    list.replaceChildren(...details.map((message) => {
      const item = document.createElement("li");
      item.textContent = message;
      return item;
    }));
    list.hidden = details.length === 0;
  }
  $("workflow-contact").hidden = false;
  for (const format of ["excel", "xero"]) {
    $(format).toggleAttribute("disabled", !draft.transactions.length || exporting);
  }
  $("save").hidden = active?.state !== "review";
  $("save").toggleAttribute("disabled", !dirty || saving);
  $("editing-note").textContent = inProgress
    ? "More rows will appear as extraction continues. You can edit them when processing finishes."
    : "Money in is positive; money out is negative. Downloads include your edits.";
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
      input.readOnly = ["queued", "processing", "uploading"].includes(active?.state);
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
  remainingPages = a.remaining;
  $("recent").hidden = !a.jobs.length;
  $("job-list").replaceChildren();
  for (const j of a.jobs) {
    const item = document.createElement("div");
    item.className = "recent-conversion";
    const b = document.createElement("button");
    b.className = "conversion-open";
    b.textContent = `${new Date(j.created_at).toLocaleDateString("en-GB")} · ${
      j.pages ?? "–"
    } pages · ${j.state === "review" ? "Ready to review" : j.state}`;
    b.onclick = () => void run(() => open(j.id));
    const trash = document.createElement("button");
    trash.className = "conversion-delete";
    trash.type = "button";
    trash.title = "Delete conversion";
    trash.setAttribute("aria-label", `Delete conversion from ${new Date(j.created_at).toLocaleDateString("en-GB")}, ${j.pages ?? "–"} pages`);
    trash.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>';
    trash.onclick = () => void run(async () => {
      trash.disabled = true;
      try { await deleteConversion(j.id); }
      finally {
        trash.disabled = false;
        if (trash.isConnected) trash.focus();
      }
    });
    item.append(b, trash);
    $("job-list").append(item);
  }
  if (!a.profile?.email) {
    stage("profile");
  } else {
    const pending = a.jobs.find((j: any) =>
      ["uploading", "queued", "processing"].includes(j.state)
    );
    if (pending && autoOpen) await open(pending.id);
    else if (active?.state === "review") stage("completed");
    else if (active?.state === "failed") stage("failed");
    else if (autoOpen && ["review", "failed"].includes(a.jobs[0]?.state)) {
      await open(a.jobs[0].id, 0, false);
    } else if (!pending) stage(a.remaining > 0 ? "upload" : "quota");
  }
}
async function open(id: string, retry = 0, scroll = true) {
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
        () => void run(() => open(id, retry + 1, scroll)),
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
  const inProgress = ["queued", "processing", "uploading"].includes(job.state);
  if (job.state === "review") {
    await account(false);
  } else if (job.state === "failed") {
    await account(false);
    if (!current()) return;
    prepareFailure(job);
    $("workflow-contact").hidden = false;
    if (scroll) $("workbench").scrollIntoView({ block: "start" });
  } else if (inProgress) {
    stage("progress");
    $("progress-text").textContent = job.state === "uploading"
      ? "Waiting for your PDF upload. Delete this conversion if the upload was interrupted."
      : `${job.next_page} of ${job.pages} pages prepared. This can take a few minutes.`;
    const poll = () => {
      if (!current()) return;
      if (exporting) timer = window.setTimeout(poll, 1000);
      else void run(() => open(id, 0, false));
    };
    timer = window.setTimeout(poll, 5000);
  }
  if (!current()) return;
  if (job.content?.corrected?.transactions.length) {
    draft = structuredClone(job.content.corrected);
    $("review").hidden = false;
    $("save-status").textContent = "";
    $("expiry").textContent = `File and transactions expire ${new Date(job.expires_at).toLocaleString("en-GB")}.`;
    renderRows();
    if (scroll && !inProgress) focusReview();
    const blob = await api("source", { id });
    if (!current()) return;
    sourceUrl = URL.createObjectURL(blob);
    $<HTMLIFrameElement>("source").src = sourceUrl;
    $<HTMLAnchorElement>("source-link").href = sourceUrl;
  }
}

function focusReview() {
  $("review-title").tabIndex = -1;
  $("review-title").focus({ preventScroll: true });
  $("review").scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    block: "start",
  });
}
$("review-result").onclick = focusReview;
for (const id of ["convert-another", "retry-statement"]) {
  $(id).onclick = () => {
    if (dirty && !confirm("Discard your unsaved corrections?")) return;
    clearReview();
    $("error").hidden = true;
    $<HTMLInputElement>("pdf").value = "";
    stage(remainingPages > 0 ? "upload" : "quota");
    $("work-title").tabIndex = -1;
    $("work-title").focus();
  };
}
function prepareFailure(job: any) {
  const failures: Record<string, string> = {
    UNSUPPORTED_STATEMENT: "We couldn’t identify one English-language GBP account statement. Try a single-account statement.",
    UNSUPPORTED_CURRENCY: "This statement contains a non-GBP or mixed-currency ledger. Try a GBP-only statement.",
    INCONSISTENT_STATEMENT: "Account details or balances conflict between pages. We haven’t combined them into a spreadsheet.",
    NO_TRANSACTIONS: "We couldn’t extract any usable transaction rows from this statement.",
  };
  $("failure-message").textContent =
    (failures[job.error_code] ?? "We couldn’t read this statement reliably.") + " Your pages have been returned.";
}
function signedOut() {
  epoch++;
  accountRequest++;
  clearReview();
  $("recent").hidden = true;
  $("job-list").replaceChildren();
  stage("profile");
}
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
async function deleteConversion(id: string) {
  const started = epoch;
  const dialog = $<HTMLDialogElement>("delete-dialog");
  if (dialog.open) return;
  const confirmed = await new Promise<boolean>((resolve) => {
    dialog.returnValue = "cancel";
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "delete"), { once: true });
    dialog.showModal();
  });
  if (!confirmed || started !== epoch) return;
  await api("delete", { id });
  if (started !== epoch) return;
  const deletingActive = active?.id === id;
  if (deletingActive) clearReview();
  await account(deletingActive);
}
for (const id of ["cancel", "delete-failed"]) {
  $(id).onclick = () =>
    void run(async () => {
      if (active) await deleteConversion(active.id);
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
      if (!active || !draft?.transactions.length || exporting) return;
      const started = epoch,
        view = navigation;
      exporting = true;
      check();
      try {
        const result = await api("export", {
          id: active.id,
          revision: active.revision,
          extracted_pages: active.extracted_pages,
          statement: structuredClone(draft),
          format,
        });
        if (started !== epoch || view !== navigation) return;
        const partial = isIncomplete(result.statement);
        const suffix = result.in_progress ? "-in-progress" : partial ? "-partial" : "";
        if (format === "xero") {
          if (result.files.length === 1) {
            download(
              new Blob([result.files[0]], { type: "text/csv;charset=utf-8" }),
              `xero-statement${suffix}.csv`,
            );
          } else {
            const { default: JSZip } = await import("jszip");
            const zip = new JSZip();
            result.files.forEach((file: string, i: number) =>
              zip.file(`xero-statement${suffix}-${i + 1}.csv`, file)
            );
            const blob = await zip.generateAsync({ type: "blob" });
            if (started !== epoch || view !== navigation) return;
            download(blob, `xero-statements${suffix}.zip`);
          }
        } else {
          const { default: ExcelJS } = await import("exceljs");
          const book = new ExcelJS.Workbook();
          const tx = book.addWorksheet(result.in_progress ? "Available transactions" : partial ? "Partial transactions" : "Transactions");
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
          if (partial || result.in_progress) {
            const extraction = book.addWorksheet("Extraction");
            extraction.columns = [{ header: "Status", width: 28 }, { header: "Detail", width: 90 }];
            extraction.addRow([
              result.in_progress ? "Extraction still in progress" : "Incomplete extraction",
              "This file contains the available results. Some transactions or details may be missing.",
            ]);
          }
          const bytes = await book.xlsx.writeBuffer();
          if (started !== epoch || view !== navigation) return;
          download(
            new Blob([new Uint8Array(bytes)], {
              type:
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            }),
            `statement${suffix}.xlsx`,
          );
        }
      } finally {
        if (started === epoch && view === navigation) {
          exporting = false;
          check();
        }
      }
    });
}
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
  if (!cap.enabled || cap.version !== API_VERSION || !cap.format_agnostic) {
    $("availability").textContent =
      "The converter is not available yet. Please check back soon.";
    return;
  }
  const { data: { session } } = await client!.auth.getSession();
  if (session) {
    $("availability").hidden = true;
    await account();
    return;
  }
  $("availability").hidden = true;
  stage("profile");
});
