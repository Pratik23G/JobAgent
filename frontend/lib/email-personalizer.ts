import * as cheerio from "cheerio";

// ─── Email Personalizer ─────────────────────────────────────────────────────
// Enriches cold email generation with company context, tech stack matching,
// and tone calibration based on recipient type

export interface CompanyContext {
  recentNews: string[];
  techStack: string[];
  companyDescription: string;
  blogPosts: string[];
}

export interface PersonalizedEmailInput {
  recipientName: string;
  recipientTitle: string;
  recipientContext?: string; // scraped info about recipient
  company: string;
  companyDomain?: string;
  roleInterest: string;
  candidateSummary: string;
  candidateSkills: string[];
  relevantProjects: { name: string; url: string; description: string; tech_stack: string[] }[];
  companyTechStack?: string[];
}

// ─── Company Context Scraping ───────────────────────────────────────────────
// Scrape company blog/about page for recent context

export async function scrapeCompanyContext(domain: string): Promise<CompanyContext> {
  const context: CompanyContext = {
    recentNews: [],
    techStack: [],
    companyDescription: "",
    blogPosts: [],
  };

  const pagesToTry = [
    { path: "/", extract: "description" },
    { path: "/about", extract: "description" },
    { path: "/blog", extract: "blog" },
  ];

  for (const page of pagesToTry) {
    try {
      const res = await fetch(`https://${domain}${page.path}`, {
        signal: AbortSignal.timeout(8000),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; JobAgent/1.0)",
          Accept: "text/html",
        },
      });
      if (!res.ok) continue;

      const html = await res.text();
      const $ = cheerio.load(html);

      if (page.extract === "description") {
        // Get meta description or first paragraph
        const metaDesc = $('meta[name="description"]').attr("content") || "";
        const ogDesc = $('meta[property="og:description"]').attr("content") || "";
        context.companyDescription = metaDesc || ogDesc || $("p").first().text().trim().slice(0, 300) || "";

        // Detect tech stack mentions from the page
        const pageText = $("body").text().toLowerCase();
        const techKeywords = [
          "react", "typescript", "python", "golang", "java", "rust", "node.js", "aws",
          "gcp", "azure", "kubernetes", "docker", "postgresql", "mongodb", "redis",
          "graphql", "rest api", "machine learning", "ai", "microservices", "terraform",
          "next.js", "vue", "angular", "django", "flask", "spring", "rails",
        ];
        context.techStack = techKeywords.filter(t => pageText.includes(t));
      }

      if (page.extract === "blog") {
        // Get recent blog post titles
        $("article h2, article h3, .post-title, [class*='blog-title'], [class*='post'] h2, [class*='post'] h3").each((_, el) => {
          const title = $(el).text().trim();
          if (title && title.length > 10 && title.length < 200) {
            context.blogPosts.push(title);
          }
        });
        context.blogPosts = context.blogPosts.slice(0, 5);
      }

      await new Promise(r => setTimeout(r, 1500)); // Rate limit
    } catch {
      continue;
    }
  }

  return context;
}

// ─── Tech Stack Matching ────────────────────────────────────────────────────
// Match user's projects to company's tech stack

export function matchProjectsToStack(
  projects: { name: string; url: string; description: string; tech_stack: string[] }[],
  companyStack: string[]
): { name: string; url: string; description: string; tech_stack: string[]; relevanceScore: number }[] {
  if (!companyStack.length || !projects.length) return projects.map(p => ({ ...p, relevanceScore: 0 }));

  const companyStackLower = companyStack.map(t => t.toLowerCase());

  return projects
    .map(project => {
      const projectStackLower = project.tech_stack.map(t => t.toLowerCase());
      const overlap = projectStackLower.filter(t =>
        companyStackLower.some(ct => ct.includes(t) || t.includes(ct))
      );
      return {
        ...project,
        relevanceScore: overlap.length / Math.max(companyStackLower.length, 1),
      };
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

// ─── Tone Calibration ───────────────────────────────────────────────────────
// Determine email tone based on recipient role

export type EmailTone = "recruiter" | "engineer" | "executive";

export function detectTone(recipientTitle: string): EmailTone {
  const title = recipientTitle.toLowerCase();

  if (
    title.includes("recruit") || title.includes("talent") ||
    title.includes("hiring") || title.includes("people") ||
    title.includes("hr") || title.includes("human resource")
  ) {
    return "recruiter";
  }

  if (
    title.includes("ceo") || title.includes("cto") || title.includes("coo") ||
    title.includes("founder") || title.includes("president") ||
    title.includes("vp") || title.includes("vice president") ||
    title.includes("director") || title.includes("head of")
  ) {
    return "executive";
  }

  return "engineer";
}

export function getToneGuidance(tone: EmailTone): string {
  switch (tone) {
    case "recruiter":
      return "Professional but warm. Lead with your value proposition and relevant experience. Be clear about what role you're interested in. Include a specific ask (e.g., 'Would you be open to a brief chat?').";
    case "engineer":
      return "Technical and peer-to-peer. Reference specific technologies or projects. Show genuine interest in their engineering challenges. Keep it brief — engineers appreciate conciseness. Mention a relevant project you built.";
    case "executive":
      return "Brief and vision-aligned. Lead with the impact you can make. Reference the company's mission or recent news. Keep it under 100 words. Be respectful of their time.";
  }
}

// ─── Build Personalized Email Context ───────────────────────────────────────
// Generates the full context string that gets passed to Claude for email generation

export async function buildEmailContext(input: PersonalizedEmailInput): Promise<string> {
  // Optionally scrape company context
  let companyContext: CompanyContext | null = null;
  if (input.companyDomain) {
    try {
      companyContext = await scrapeCompanyContext(input.companyDomain);
    } catch {
      // Silent fail — email generation can work without this
    }
  }

  const combinedTechStack = [
    ...(input.companyTechStack || []),
    ...(companyContext?.techStack || []),
  ].filter((v, i, a) => a.indexOf(v) === i);

  const matchedProjects = matchProjectsToStack(input.relevantProjects || [], combinedTechStack);
  const topProjects = matchedProjects.slice(0, 2);

  const tone = detectTone(input.recipientTitle);
  const toneGuidance = getToneGuidance(tone);

  const parts: string[] = [];

  parts.push(`Recipient: ${input.recipientName}, ${input.recipientTitle} at ${input.company}`);

  if (input.recipientContext) {
    parts.push(`About the recipient: ${input.recipientContext}`);
  }

  if (companyContext?.companyDescription) {
    parts.push(`About ${input.company}: ${companyContext.companyDescription}`);
  }

  if (companyContext?.blogPosts?.length) {
    parts.push(`Recent blog posts: ${companyContext.blogPosts.slice(0, 3).join("; ")}`);
  }

  if (combinedTechStack.length > 0) {
    parts.push(`Company tech stack: ${combinedTechStack.join(", ")}`);
  }

  parts.push(`Role of interest: ${input.roleInterest}`);
  parts.push(`Candidate summary: ${input.candidateSummary}`);
  parts.push(`Key skills: ${input.candidateSkills.join(", ")}`);

  if (topProjects.length > 0) {
    parts.push(`Relevant projects to mention:`);
    for (const p of topProjects) {
      parts.push(`  - ${p.name} (${p.url}): ${p.description}. Tech: ${p.tech_stack.join(", ")}`);
    }
  }

  parts.push(`\nEmail tone: ${tone} — ${toneGuidance}`);

  return parts.join("\n");
}
