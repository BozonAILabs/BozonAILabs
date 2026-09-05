// All marketing content is rendered in HTML. JavaScript enhances the workflow
// examples and calculates an explicitly illustrative capacity scenario.
const tabs = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-workflow]"),
);
const panels = Array.from(
  document.querySelectorAll<HTMLElement>(".workflow-panel"),
);

function selectWorkflow(tab: HTMLButtonElement, moveFocus = false): void {
  tabs.forEach((item) => {
    const selected = item === tab;
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
  });
  panels.forEach((panel) => {
    panel.hidden = panel.id !== tab.getAttribute("aria-controls");
  });
  if (moveFocus) tab.focus();
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectWorkflow(tab));
  tab.addEventListener("keydown", (event: KeyboardEvent) => {
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % tabs.length;
        break;
      case "ArrowLeft":
        next = (index - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    selectWorkflow(tabs[next]!, true);
  });
});

const clients = document.querySelector<HTMLInputElement>("#clients")!;
const minutes = document.querySelector<HTMLInputElement>("#minutes")!;
const clientsOutput =
  document.querySelector<HTMLOutputElement>("#clients-output")!;
const minutesOutput =
  document.querySelector<HTMLOutputElement>("#minutes-output")!;
const hoursOutput = document.querySelector<HTMLOutputElement>("#hours-output")!;
const calculation = document.querySelector<HTMLElement>("#calculation")!;
const format = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

function updateCapacity(): void {
  const clientCount = Number(clients.value);
  const minutesSaved = Number(minutes.value);
  clientsOutput.value = String(clientCount);
  minutesOutput.value = String(minutesSaved);
  hoursOutput.value = format.format((clientCount * minutesSaved) / 60);
  calculation.textContent = `${clientCount} clients × ${minutesSaved} minutes ÷ 60`;
  clients.setAttribute("aria-valuetext", `${clientCount} clients`);
  minutes.setAttribute(
    "aria-valuetext",
    `${minutesSaved} minutes per client per month`,
  );
}
clients.addEventListener("input", updateCapacity);
minutes.addEventListener("input", updateCapacity);
updateCapacity();
