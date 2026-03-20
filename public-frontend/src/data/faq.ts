export interface FAQItem {
  question: string;
  answer: string;
}

export const faqItems: FAQItem[] = [
  {
    question: "What exactly is a credit?",
    answer:
      "Credits are the unit of compute your agents consume. Simple tasks like replying to an FAQ cost ~0.5 credits. Complex tasks like writing a research report cost 5–15 credits. Each agent type has a visible baseline rate.",
  },
  {
    question: "Do unused credits expire?",
    answer:
      "On Growth and Enterprise plans, unused credits roll over to the next month indefinitely. Starter plan credits reset monthly.",
  },
  {
    question: "Can I run multiple agents simultaneously?",
    answer:
      "Yes. All plans support concurrent agent execution. Credits are consumed in parallel. You can set daily credit caps per agent to control spend.",
  },
  {
    question: "Is my business data safe?",
    answer:
      "All data is encrypted in transit (TLS 1.3) and at rest (AES-256). Agents run in isolated sandboxes. We never use your data to train models. Enterprise customers can request on-premise deployment.",
  },
  {
    question: "How quickly can I deploy an agent?",
    answer:
      "Most agents are live in under 4 minutes. Connect your tools, set preferences in plain language, and hit deploy. No code required.",
  },
];
