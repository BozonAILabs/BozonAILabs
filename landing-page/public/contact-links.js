// Shared email copy for contact CTAs, including standalone static pages.
// The HTML mailto remains usable if JavaScript is unavailable.
const contactMessages = {
  general: {
    subject: "Workflow enquiry",
    introduction: "I’d like to discuss reducing manual work in our practice.",
  },
  converter: {
    subject: "Workflow enquiry — Bank statement converter",
    introduction: "I’m getting in touch from your bank statement converter page. I’d like to discuss bank statement conversion in our practice.",
  },
};

for (const link of document.querySelectorAll("a[data-contact]")) {
  const message = contactMessages[link.dataset.contact];
  if (!message) continue;
  const body = [
    "Hi Bozon AI Labs,",
    "",
    message.introduction,
    "",
    "Practice name:",
    "What we’d like help with:",
  ].join("\n");
  link.href = `mailto:dev@bozonailabs.com?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(body)}`;
}
