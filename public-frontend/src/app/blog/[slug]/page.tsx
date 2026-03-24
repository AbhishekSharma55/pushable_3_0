import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PageShell from "@/components/PageShell";
import MarkdownRenderer from "@/components/MarkdownRenderer";

// SSG: statically generate all blog pages at build time, revalidate every hour
export const revalidate = 3600;
export const dynamicParams = false;

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  content: string;
  emoji: string | null;
  tag: string | null;
  author: string | null;
  readTime: string | null;
  publishedAt: string | null;
}

// Pre-generate all published blog slugs at build time
export async function generateStaticParams() {
  const apiUrl =
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "https://api.pushable.ai";
  try {
    const res = await fetch(`${apiUrl}/api/public/blogs`, {
      cache: "force-cache",
    });
    if (!res.ok) return [];
    const json = await res.json();
    const blogs: BlogPost[] = json.data ?? [];
    return blogs.map((blog) => ({ slug: blog.slug }));
  } catch {
    return [];
  }
}

async function getBlog(slug: string): Promise<BlogPost | null> {
  const apiUrl =
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "https://api.pushable.ai";
  try {
    const res = await fetch(`${apiUrl}/api/public/blogs/${slug}`, {
      cache: "force-cache",
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch {
    return null;
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const blog = await getBlog(slug);
  if (!blog) {
    return { title: "Blog — Pushable.ai" };
  }
  return {
    title: `${blog.title} — Pushable.ai`,
    description: blog.description || undefined,
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const blog = await getBlog(slug);

  if (!blog) {
    notFound();
  }

  return (
    <PageShell>
      <div className="blog-hero rev">
        <a href="/blog" className="blog-back">
          ← Back to blog
        </a>
        {blog.tag && <div className="blog-hero-tag">{blog.tag}</div>}
        <h1>{blog.title}</h1>
        <div className="blog-hero-meta">
          {blog.author && (
            <span>
              By <strong style={{ color: "var(--text)" }}>{blog.author}</strong>
            </span>
          )}
          {blog.publishedAt && <span>{formatDate(blog.publishedAt)}</span>}
          {blog.readTime && <span>{blog.readTime}</span>}
        </div>
        <hr className="blog-hero-divider" />
      </div>

      <div className="prose rev d1">
        <MarkdownRenderer content={blog.content} />
      </div>

      {/* Back to blog CTA */}
      <div
        className="rev"
        style={{
          textAlign: "center",
          padding: "40px 32px 80px",
          position: "relative",
          zIndex: 1,
        }}
      >
        <a
          href="/blog"
          className="btn btn-ghost btn-lg"
        >
          ← Back to all posts
        </a>
      </div>
    </PageShell>
  );
}
