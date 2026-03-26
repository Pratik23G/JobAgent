import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { anthropic } from "@/lib/claude";
import { getServiceClient } from "@/lib/db";

export async function POST(request: Request) {
  // Try auth, but allow anonymous fallback for development
  let userId: string | null = null;
  try {
    const session = await getServerSession(authOptions);
    userId = (session?.user as { id?: string })?.id || null;
  } catch {
    // Auth may be misconfigured — continue without it
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file || file.type !== "application/pdf") {
    return new Response("Please upload a PDF file", { status: 400 });
  }

  // Read file as base64
  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");

  // Send to Claude for parsing
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64,
            },
          },
          {
            type: "text",
            text: `Parse this resume and return ONLY valid JSON with this exact structure:
{
  "name": "string",
  "email": "string",
  "phone": "string or null",
  "address": {
    "street": "string or null",
    "city": "string or null",
    "state": "string or null",
    "zip": "string or null",
    "country": "string or null"
  },
  "linkedin": "string or null",
  "website": "string or null",
  "skills": ["string"],
  "experience": [{"title": "string", "company": "string", "duration": "string", "start_date": "string or null", "end_date": "string or null", "description": "string or null", "location": "string or null"}],
  "education": [{"degree": "string", "school": "string", "field_of_study": "string or null", "graduation_year": "string or null", "gpa": "string or null"}],
  "certifications": ["string"],
  "work_authorization": "string or null (e.g. US Citizen, Green Card, H1B, etc.)",
  "summary": "one paragraph summary of the candidate"
}
Extract ALL information present in the resume. For address, parse the full mailing address into components. For linkedin/website/github, extract the URLs. For experience, include full descriptions and dates. For skills, list every technical and soft skill mentioned.
Return ONLY the JSON, no markdown, no explanation.`,
          },
        ],
      },
    ],
  });

  const rawText =
    message.content[0].type === "text" ? message.content[0].text : "";

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return new Response("Failed to parse resume — AI returned invalid JSON", {
      status: 500,
    });
  }

  // Derive userId from auth or sessionId (same pattern as agent route)
  const sessionId = formData.get("sessionId") as string | null;
  if (!userId && sessionId) {
    userId = `anon_${sessionId}`;
  }

  // Store the resume base64 as a data URI so the extension can use it for ATS upload
  const resumeDataUri = `data:application/pdf;base64,${base64}`;

  // Store in Supabase (always — auth or anonymous)
  if (userId) {
    const supabase = getServiceClient();
    const { error: dbError } = await supabase.from("resumes").upsert(
      {
        user_id: userId,
        raw_text: rawText,
        parsed_json: parsed,
        file_url: resumeDataUri,
      },
      { onConflict: "user_id" }
    );

    if (dbError) {
      console.error("Supabase error:", dbError);
    }
  }

  return Response.json({ parsed, resumeBase64: resumeDataUri });
}
