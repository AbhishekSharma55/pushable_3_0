export interface Testimonial {
  text: string;
  highlight: string;
  initials: string;
  name: string;
  role: string;
}

export const testimonials: Testimonial[] = [
  {
    text: '"The Support Agent handles ',
    highlight: "300+ tickets daily",
    initials: "AS",
    name: "Arjun Sharma",
    role: "Head of CX, Zeta Commerce",
  },
  {
    text: '"Replaced two vendor tools with Pushable. The ',
    highlight: "credit model is honest",
    initials: "PR",
    name: "Priya Rajan",
    role: "COO, Loopcraft Labs",
  },
  {
    text: '"Research Agent summarises competitor moves every morning. A ',
    highlight: "10-minute briefing",
    initials: "MK",
    name: "Marcus Klein",
    role: "VP Strategy, Foundry Group",
  },
  {
    text: '"Deployed the HR Screener before our hiring sprint. ',
    highlight: "200 applications processed",
    initials: "JL",
    name: "Jessica Liu",
    role: "People Lead, Axiom Health",
  },
  {
    text: '"Finance Auditor caught ',
    highlight: "three billing anomalies",
    initials: "DM",
    name: "David Müller",
    role: "CFO, NorthFlux Capital",
  },
];

export const testimonialAfterText: Record<string, string> = {
  AS: ". Our team only touches escalations. Response time went from 6h to 8 minutes.\"",
  PR: " — we pay for actual work done, not seats gathering dust.\"",
  MK: " that used to take my analyst a full day.\"",
  JL: " in a weekend. Hire quality went up noticeably.\"",
  DM: " in the first week. Paid for itself on day two. Fully rolling it out now.\"",
};
