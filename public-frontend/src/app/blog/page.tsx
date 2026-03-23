import type { Metadata } from "next";
import PageShell from "@/components/PageShell";

// SSG: statically generate at build time, revalidate every hour
export const revalidate = 3600;
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Blog — Pushable.ai",
  description:
    "Insights on AI automation, agent deployment, and the future of work from the Pushable.ai team.",
};

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  content: string;
  emoji: string | null;
  tag: string | null;
  coverImage: string | null;
  author: string | null;
  readTime: string | null;
  featured: boolean;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function getBlogs(): Promise<BlogPost[]> {
  const apiUrl =
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:4000";
  try {
    const res = await fetch(`${apiUrl}/api/public/blogs`, {
      cache: "force-cache",
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.data ?? [];
  } catch {
    return [];
  }
}

export default async function BlogPage() {
  const blogs = await getBlogs();
  const featured = blogs.find((b) => b.featured);
  const rest = blogs.filter((b) => !b.featured);

  return (
    <PageShell>
      <div className="page-header">
        <div className="ey rev">Blog</div>
        <h1 className="rev d1">
          <span className="grad">Insights &amp; updates</span>{" "}
          <span className="hl">from the team.</span>
        </h1>
        <p className="page-sub rev d2">
          Product launches, engineering deep dives, customer stories, and
          thoughts on the future of AI-powered work.
        </p>
      </div>

      <section className="sec" style={{ paddingTop: 0 }}>
        {blogs.length === 0 ? (
          <div
            className="rev"
            style={{
              textAlign: "center",
              padding: "80px 32px",
            }}
          >
            <div
              style={{
                fontSize: "48px",
                marginBottom: "20px",
              }}
            >
              ✍️
            </div>
            <h3
              style={{
                fontSize: "20px",
                fontWeight: 600,
                marginBottom: "8px",
              }}
            >
              Coming soon
            </h3>
            <p
              style={{
                fontSize: "15px",
                color: "var(--text2)",
                maxWidth: "400px",
                margin: "0 auto",
              }}
            >
              We&apos;re working on our first posts. Check back soon for
              product updates, engineering deep dives, and customer stories.
            </p>
          </div>
        ) : (
          <div className="blog-grid">
            {/* Featured Post */}
            {featured && (
              <a
                href={`/blog/${featured.slug}`}
                className="blog-card blog-featured rev"
              >
                <div className="blog-card-img">
                  {featured.emoji || "📝"}
                </div>
                <div className="blog-card-body">
                  {featured.tag && (
                    <span className="blog-card-tag">{featured.tag}</span>
                  )}
                  <h3>{featured.title}</h3>
                  {featured.description && <p>{featured.description}</p>}
                  <span className="blog-card-meta">
                    {formatDate(featured.publishedAt)}
                    {featured.readTime &&
                      ` · ${featured.readTime}`}
                  </span>
                </div>
              </a>
            )}

            {/* Other Posts */}
            {rest.map((post, i) => (
              <a
                key={post.id}
                href={`/blog/${post.slug}`}
                className={`blog-card rev ${i % 3 === 0 ? "" : i % 3 === 1 ? "d1" : "d2"}`}
              >
                <div className="blog-card-img">{post.emoji || "📝"}</div>
                <div className="blog-card-body">
                  {post.tag && (
                    <span className="blog-card-tag">{post.tag}</span>
                  )}
                  <h3>{post.title}</h3>
                  {post.description && <p>{post.description}</p>}
                  <span className="blog-card-meta">
                    {formatDate(post.publishedAt)}
                    {post.readTime && ` · ${post.readTime}`}
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      {/* Newsletter CTA */}
      <div className="cta-wrap">
        <div className="cta-inner rev">
          <h2 className="cta-h">
            Stay in the
            <br />
            <span style={{ color: "var(--text3)" }}>loop.</span>
          </h2>
          <p className="cta-sub">
            Get product updates, engineering insights, and AI industry news
            delivered to your inbox.
          </p>
          <div
            className="cta-btns"
            style={{ maxWidth: 440, margin: "0 auto" }}
          >
            <a href="#" className="btn btn-green btn-lg">
              Subscribe to newsletter →
            </a>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
