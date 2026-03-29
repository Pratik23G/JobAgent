import * as cheerio from "cheerio";

// ─── Contact Discovery Service ──────────────────────────────────────────────
// Multi-strategy contact finder for cold outreach
// Strategies (in order of reliability):
// 1. Hunter.io API — verified emails by domain
// 2. Company website scraping — /about, /team pages via cheerio
// 3. GitHub org search — public emails from org members
// 4. Email pattern generation — guess common email formats

export interface ContactResult {
  person_name: string;
  title: string;
  email: string;
  linkedin_url?: string;
  source: string;
  confidence: number; // 0.0 to 1.0
}

// ─── Strategy 1: Hunter.io API ──────────────────────────────────────────────
// Requires HUNTER_API_KEY env var (free tier: 25 searches/month)

async function hunterDomainSearch(domain: string): Promise<ContactResult[]> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(
      `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${apiKey}&limit=10`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return [];

    const data = await res.json();
    const emails = data?.data?.emails || [];

    return emails.map((e: {
      first_name?: string;
      last_name?: string;
      position?: string;
      value?: string;
      linkedin?: string;
      confidence?: number;
    }) => ({
      person_name: `${e.first_name || ""} ${e.last_name || ""}`.trim(),
      title: e.position || "",
      email: e.value || "",
      linkedin_url: e.linkedin || undefined,
      source: "hunter_api",
      confidence: (e.confidence || 0) / 100,
    }));
  } catch {
    return [];
  }
}

async function hunterEmailVerify(email: string): Promise<boolean> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) return false;

  try {
    const res = await fetch(
      `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${apiKey}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return false;
    const data = await res.json();
    return data?.data?.result === "deliverable";
  } catch {
    return false;
  }
}

// ─── Strategy 2: Company Website Scraping ───────────────────────────────────
// Fetches /about, /team, /people pages and extracts contacts via cheerio

const TEAM_PAGE_PATHS = [
  "/about", "/team", "/about-us", "/people", "/our-team",
  "/about/team", "/company", "/company/team", "/leadership",
];

async function scrapeCompanyWebsite(domain: string): Promise<ContactResult[]> {
  const contacts: ContactResult[] = [];
  const seenEmails = new Set<string>();

  for (const path of TEAM_PAGE_PATHS) {
    try {
      const url = `https://${domain}${path}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; JobAgent/1.0)",
          Accept: "text/html",
        },
      });
      if (!res.ok) continue;

      const html = await res.text();
      const $ = cheerio.load(html);

      // Extract mailto links
      $("a[href^='mailto:']").each((_, el) => {
        const email = $(el).attr("href")?.replace("mailto:", "").split("?")[0]?.trim();
        if (email && !seenEmails.has(email)) {
          seenEmails.add(email);
          // Try to get nearby name text
          const parent = $(el).closest("[class*='team'], [class*='member'], [class*='person'], [class*='card'], [class*='staff'], li, article, div");
          const nameEl = parent.find("h2, h3, h4, h5, [class*='name'], strong").first();
          const titleEl = parent.find("[class*='title'], [class*='role'], [class*='position'], p, span").first();

          contacts.push({
            person_name: nameEl.text().trim().slice(0, 100) || "",
            title: titleEl.text().trim().slice(0, 100) || "",
            email,
            source: "website_scrape",
            confidence: 0.8,
          });
        }
      });

      // Extract team member cards (common patterns)
      $("[class*='team-member'], [class*='team_member'], [class*='person-card'], [class*='staff-member'], [class*='member-card']").each((_, el) => {
        const name = $(el).find("h2, h3, h4, h5, [class*='name'], strong").first().text().trim();
        const title = $(el).find("[class*='title'], [class*='role'], [class*='position']").first().text().trim();
        const emailLink = $(el).find("a[href^='mailto:']").attr("href");
        const linkedinLink = $(el).find("a[href*='linkedin.com']").attr("href");

        if (name && name.length > 2 && name.length < 80) {
          const email = emailLink?.replace("mailto:", "").split("?")[0]?.trim() || "";
          if (email && !seenEmails.has(email)) {
            seenEmails.add(email);
            contacts.push({
              person_name: name,
              title: title.slice(0, 100),
              email,
              linkedin_url: linkedinLink || undefined,
              source: "website_scrape",
              confidence: 0.7,
            });
          } else if (linkedinLink) {
            // No email but have LinkedIn — still useful
            contacts.push({
              person_name: name,
              title: title.slice(0, 100),
              email: "",
              linkedin_url: linkedinLink,
              source: "website_scrape",
              confidence: 0.3,
            });
          }
        }
      });

      // If we found contacts on this page, no need to try more paths
      if (contacts.length > 0) break;

      // Rate limit between page fetches
      await new Promise(r => setTimeout(r, 2000));
    } catch {
      continue;
    }
  }

  return contacts;
}

// ─── Strategy 3: GitHub Organization Search ─────────────────────────────────

async function searchGithubOrg(companyName: string): Promise<ContactResult[]> {
  try {
    // Search for GitHub org by company name
    const searchRes = await fetch(
      `https://api.github.com/search/users?q=${encodeURIComponent(companyName)}+type:org&per_page=3`,
      {
        signal: AbortSignal.timeout(10000),
        headers: {
          Accept: "application/vnd.github.v3+json",
          ...(process.env.GITHUB_TOKEN ? { Authorization: `token ${process.env.GITHUB_TOKEN}` } : {}),
        },
      }
    );
    if (!searchRes.ok) return [];

    const searchData = await searchRes.json();
    const orgs = searchData?.items || [];
    if (orgs.length === 0) return [];

    const org = orgs[0];
    const contacts: ContactResult[] = [];

    // Get org members (public only)
    const membersRes = await fetch(
      `https://api.github.com/orgs/${org.login}/members?per_page=10`,
      {
        signal: AbortSignal.timeout(10000),
        headers: {
          Accept: "application/vnd.github.v3+json",
          ...(process.env.GITHUB_TOKEN ? { Authorization: `token ${process.env.GITHUB_TOKEN}` } : {}),
        },
      }
    );
    if (!membersRes.ok) return [];

    const members = await membersRes.json();

    for (const member of members.slice(0, 10)) {
      // Get full profile for email
      const profileRes = await fetch(
        `https://api.github.com/users/${member.login}`,
        {
          signal: AbortSignal.timeout(5000),
          headers: {
            Accept: "application/vnd.github.v3+json",
            ...(process.env.GITHUB_TOKEN ? { Authorization: `token ${process.env.GITHUB_TOKEN}` } : {}),
          },
        }
      );
      if (!profileRes.ok) continue;

      const profile = await profileRes.json();
      if (profile.email) {
        contacts.push({
          person_name: profile.name || member.login,
          title: profile.bio?.slice(0, 100) || "Engineer",
          email: profile.email,
          linkedin_url: undefined,
          source: "github",
          confidence: 0.6,
        });
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 500));
    }

    return contacts;
  } catch {
    return [];
  }
}

// ─── Strategy 4: Email Pattern Generation ───────────────────────────────────
// Given a person's name and company domain, generate likely email addresses

function generateEmailPatterns(firstName: string, lastName: string, domain: string): string[] {
  const f = firstName.toLowerCase().replace(/[^a-z]/g, "");
  const l = lastName.toLowerCase().replace(/[^a-z]/g, "");
  if (!f || !l || !domain) return [];

  return [
    `${f}@${domain}`,
    `${f}.${l}@${domain}`,
    `${f}${l}@${domain}`,
    `${f[0]}${l}@${domain}`,
    `${f}_${l}@${domain}`,
    `${f}-${l}@${domain}`,
    `${f}${l[0]}@${domain}`,
    `${l}@${domain}`,
  ];
}

async function guessEmails(names: { firstName: string; lastName: string; title: string }[], domain: string): Promise<ContactResult[]> {
  const contacts: ContactResult[] = [];

  for (const { firstName, lastName, title } of names) {
    const patterns = generateEmailPatterns(firstName, lastName, domain);

    // If Hunter.io available, verify the most likely pattern
    const verified = await hunterEmailVerify(patterns[1] || patterns[0]); // first.last@domain
    if (verified) {
      contacts.push({
        person_name: `${firstName} ${lastName}`,
        title,
        email: patterns[1] || patterns[0],
        source: "email_pattern",
        confidence: 0.9,
      });
    } else {
      // Can't verify — still provide as low-confidence guess
      contacts.push({
        person_name: `${firstName} ${lastName}`,
        title,
        email: patterns[1] || patterns[0], // first.last@domain is most common
        source: "email_pattern",
        confidence: 0.3,
      });
    }
  }

  return contacts;
}

// ─── Main: Run All Strategies ───────────────────────────────────────────────

export async function discoverContacts(
  company: string,
  domain?: string,
  targetRoles?: string[]
): Promise<ContactResult[]> {
  // Derive domain from company name if not provided
  const companyDomain = domain || deriveCompanyDomain(company);

  // Run strategies in parallel
  const [hunterResults, websiteResults, githubResults] = await Promise.all([
    companyDomain ? hunterDomainSearch(companyDomain) : Promise.resolve([]),
    companyDomain ? scrapeCompanyWebsite(companyDomain) : Promise.resolve([]),
    searchGithubOrg(company),
  ]);

  // Combine and deduplicate
  const allContacts = [...hunterResults, ...websiteResults, ...githubResults];
  const deduped = deduplicateContacts(allContacts);

  // Filter by target roles if specified
  let filtered = deduped;
  if (targetRoles?.length) {
    const roleKeywords = targetRoles.map(r => r.toLowerCase());
    filtered = deduped.filter(c => {
      const title = c.title.toLowerCase();
      return roleKeywords.some(role =>
        title.includes(role) ||
        (role === "recruiter" && (title.includes("talent") || title.includes("hiring") || title.includes("people") || title.includes("hr"))) ||
        (role === "engineer" && (title.includes("software") || title.includes("developer") || title.includes("sre") || title.includes("engineering"))) ||
        (role === "hiring manager" && (title.includes("manager") || title.includes("lead") || title.includes("director")))
      );
    });

    // If no results match roles, return all contacts (better than nothing)
    if (filtered.length === 0) filtered = deduped;
  }

  // Sort by confidence
  return filtered.sort((a, b) => b.confidence - a.confidence);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function deriveCompanyDomain(company: string): string {
  // Simple heuristic: lowercase, remove common suffixes, add .com
  const clean = company
    .toLowerCase()
    .replace(/\s*(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|corporation|technologies|tech|group|labs?)\s*/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
  return clean ? `${clean}.com` : "";
}

function deduplicateContacts(contacts: ContactResult[]): ContactResult[] {
  const seen = new Map<string, ContactResult>();
  for (const c of contacts) {
    const key = c.email ? c.email.toLowerCase() : `${c.person_name}-${c.linkedin_url}`;
    if (!key || key === "-") continue;

    const existing = seen.get(key);
    if (!existing || c.confidence > existing.confidence) {
      seen.set(key, c);
    }
  }
  return Array.from(seen.values());
}

export { generateEmailPatterns, hunterEmailVerify, guessEmails };
