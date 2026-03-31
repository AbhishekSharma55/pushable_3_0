# Public Website

The public frontend is a Next.js marketing site that showcases the Pushable AI platform. It includes a landing page, pricing, agent showcase, blog, documentation, contact form, and legal pages.

---

## Overview

| Aspect | Details |
|--------|---------|
| **URL** | `http://localhost:3001` |
| **Framework** | Next.js 16.2.0, React 19.2.4 |
| **Styling** | Tailwind CSS 4 + custom CSS (2,497 lines) |
| **Theme** | Dark mode (near-black backgrounds, green accents) |
| **Build** | Standalone output for Docker deployment |
| **SSG/ISR** | Blog pages use static generation with 1-hour revalidation |

---

## Pages

| Route | Type | Description |
|-------|------|-------------|
| `/` | Server | Landing page with all marketing sections |
| `/pricing` | Server | Pricing tiers with feature comparison |
| `/agents` | Server | AI agent showcase (6 agent types) |
| `/credits` | Server | Credit system explanation with interactive simulator |
| `/blog` | Server (SSG) | Blog listing with featured post |
| `/blog/[slug]` | Server (SSG) | Individual blog post with Markdown rendering |
| `/docs` | Server | Documentation hub (static content) |
| `/contact` | Server | Contact form with category selection |
| `/about` | Server | Company info, mission, values |
| `/privacy` | Server | Privacy policy (last updated March 2026) |
| `/terms` | Server | Terms of service (last updated March 2026) |

---

## Landing Page (`/`)

The homepage is composed of these sections in order:

| Section | Component | Description |
|---------|-----------|-------------|
| Background | `GridBackground` + `ParticleCanvas` | Fixed grid overlay + animated green particles |
| Navigation | `Navbar` | Logo, nav links, auth buttons |
| Hero | `Hero` (HeroCopy + DashboardCard) | Headline, stats, CTAs, mock dashboard |
| Social proof | `LogoMarquee` | 10 company logos (Vercel, Linear, Notion, Stripe, etc.) |
| Agents | `AgentsBento` | 6-agent grid with capabilities |
| Process | `HowItWorks` | 3-step deployment (Choose → Configure → Monitor) |
| Credits | `CreditSystem` | Credit overview + interactive simulator |
| Pricing | `PricingSection` | 3-tier cards with annual toggle |
| Testimonials | `Testimonials` | 5 customer quotes in marquee |
| FAQ | `FAQ` | Expandable Q&A |
| CTA | `CTASection` | Final conversion call-to-action |
| Footer | `Footer` | Links, legal, copyright |

### Hero Stats

- 1.8M+ tasks completed
- 99.4% uptime SLA
- <4 min average deploy time

---

## Pricing Page (`/pricing`)

### Pricing Tiers

| Tier | Price | Credits | Agents | Key Features |
|------|-------|---------|--------|-------------|
| **Starter** | Free | 100/month | 2 | Support + Research agents, basic analytics |
| **Growth** | $49/mo ($39/yr) | 2,000/month | All 6 | Credit rollover, priority support, custom workflows, advanced analytics |
| **Enterprise** | Custom | Unlimited | All 6 + Custom | SSO/SAML, 99.9% SLA, dedicated success manager, on-premise option |

Annual pricing toggle shows 20% discount.

### Feature Comparison Table

Compares all three tiers across: monthly credits, active agents, agent types, credit rollover, priority support, custom workflows, advanced analytics, SSO/SAML, SLA guarantee, on-premise deployment.

---

## Agent Showcase (`/agents`)

Displays 6 pre-built AI agent types:

| Agent | Emoji | Cost | Badge |
|-------|-------|------|-------|
| **Support Agent** | 🎧 | 4 cr/hr | Most Popular |
| **Sales Agent** | 📬 | 6 cr/hr | Growth+ |
| **Research Analyst** | 🔬 | 8 cr/hr | All Plans |
| **HR Screener** | 👤 | 5 cr/hr | Growth+ |
| **Finance Auditor** | 📊 | 7 cr/hr | Growth+ |
| **Code Reviewer** | 💻 | 8 cr/hr | New |

Each agent card shows 8 capabilities. Example (Support Agent):
- Auto-resolve tickets, escalation routing, multi-language support, FAQ automation, follow-ups, CSAT surveys, sentiment prioritization, knowledge base access

---

## Credits Page (`/credits`)

### Credit Pricing Breakdown

| Complexity | Cost Range | Examples |
|-----------|-----------|---------|
| Simple replies | ~0.5 cr | Quick answers, greetings |
| Moderate tasks | 2-6 cr | Research, data lookup |
| Complex tasks | 5-15 cr | Multi-step analysis |
| Browser actions | 1-3 cr | Web navigation |
| Scheduled runs | 2-8 cr | Automated tasks |

### Credit Simulator

Interactive sliders for:
- Support tickets per day
- Sales leads per week
- Research reports per month

Calculates estimated monthly credit usage.

---

## Blog System

### Blog Listing (`/blog`)

- **Data source:** `GET /api/public/blogs` (fetched at build time)
- **Caching:** `force-cache` with 3600s ISR (1-hour revalidation)
- **Layout:** Featured post (large card) + grid of remaining posts
- **Display:** Title, description, tag, publish date, read time, emoji badge
- **Empty state:** Fallback message when no posts exist

### Blog Detail (`/blog/[slug]`)

- **Static generation:** Uses `generateStaticParams()` to pre-build all published posts
- **Data source:** `GET /api/public/blogs/{slug}`
- **Rendering:** Markdown content via `MarkdownRenderer` (react-markdown + remark-gfm)
- **Metadata:** Dynamic title and description per post via `generateMetadata()`
- **404 handling:** `notFound()` for missing slugs
- **Revalidation:** 3600s (1 hour)

### Blog Data Structure

```typescript
interface BlogPost {
  id: string;
  title: string;
  slug: string;
  description: string;
  content: string;       // Markdown
  emoji: string;
  tag: string;
  coverImage: string;
  author: string;
  readTime: string;
  featured: boolean;
  published: boolean;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## Contact Page (`/contact`)

### Form Fields

| Field | Type | Options |
|-------|------|---------|
| Name | Text input | Required |
| Email | Email input | Required |
| Subject | Dropdown | General Inquiry, Sales & Enterprise, Technical Support, Partnerships |
| Message | Textarea | Required |

### Submission

- **Endpoint:** `POST /api/public/contact`
- **No auth required** (public route)
- **Success:** Confirmation message displayed
- **Error:** Error toast shown

### Contact Cards

| Department | Email |
|-----------|-------|
| Sales & Enterprise | sales@pushable.ai |
| Technical Support | support@pushable.ai |
| Partnerships | partners@pushable.ai |

---

## Documentation Page (`/docs`)

Static content (no API calls) organized in 3 sections:

### Getting Started (3 cards)
- Quick Start Guide
- Agent Configuration
- Understanding Credits

### Integrations (6 cards)
- Slack, Gmail/Email, Notion/Docs, HubSpot CRM, Webhooks, API Reference

### Advanced (6 cards)
- Knowledge Base, Custom Workflows, Team Management, Browser Automation, Scheduled Agents, Security & Compliance

Each card links to relevant documentation.

---

## Legal Pages

### Privacy Policy (`/privacy`)

Last updated: March 2026. Covers:
- Information collection and usage
- Google user data handling
- Third-party services (Composio)
- Data storage and sharing
- User control and data deletion
- Policy changes and contact

### Terms of Service (`/terms`)

Last updated: March 2026. Covers:
- Use of service
- User responsibilities
- Google integration terms
- Third-party services
- Limitation of liability
- Termination and changes

---

## Backend API Integration

The public frontend communicates with the backend API for dynamic content:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/public/blogs` | GET | Fetch all published blog posts |
| `/api/public/blogs/:slug` | GET | Fetch individual blog post |
| `/api/public/contact` | POST | Submit contact form |

### API Routing

Next.js config rewrites API calls to the backend:

```typescript
// next.config.ts
rewrites: [
  { source: "/api/:path*", destination: `${API_URL}/api/:path*` }
]
```

- **Server-side:** Uses `API_URL` env var (internal Docker URL: `http://backend:4000`)
- **Client-side:** Uses `NEXT_PUBLIC_API_URL` (external URL)

---

## Design System

### Colors

| Variable | Value | Usage |
|----------|-------|-------|
| `--bg` | `#09090b` | Primary background |
| `--bg2` | `#111113` | Card backgrounds |
| `--bg3` | `#18181b` | Elevated surfaces |
| `--text` | `#fafafa` | Primary text |
| `--text2` | `#a1a1aa` | Secondary text |
| `--green` | `#22c55e` | Accent, CTAs |
| `--amber` | `#f59e0b` | Warnings, highlights |
| `--border` | `#27272a` | Borders |

### Animations

- **ParticleCanvas** -- 55 bouncing particles with connecting lines (green theme)
- **ScrollReveal** -- Intersection Observer for `.rev` elements with 50ms stagger
- **LogoMarquee** -- Infinite scrolling logo carousel
- **Testimonials** -- Marquee carousel with looping quotes

### Typography

- **Sans:** Inter
- **Mono:** JetBrains Mono

---

## SEO

Each page has custom metadata:

| Page | Title |
|------|-------|
| Home | Pushable.ai -- AI Employees for Modern Teams |
| Pricing | Simple, transparent pricing for Pushable.ai |
| Blog | Insights on AI automation, agent deployment |
| Contact | Get in touch with the Pushable.ai team |
| Docs | Get started with Pushable.ai |
| About | Learn about Pushable.ai |
| Agents | Explore Pushable.ai's 6 AI agent types |
| Credits | Understand how Pushable.ai credits work |
| Privacy | How Pushable.ai collects and protects your data |
| Terms | Pushable.ai Terms and Conditions |

Blog detail pages generate metadata dynamically via `generateMetadata()`.

---

## Next Steps

- [API Reference](./15-api-reference.md) -- Complete endpoint listing
- [Database Schema](./16-database-schema.md) -- All 33 tables
