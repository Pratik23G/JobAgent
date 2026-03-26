"""
JobAgent RAG Matcher — Python microservice for semantic job matching.

Accepts a PDF resume, extracts text, generates embeddings with sentence-transformers,
fetches jobs from Adzuna/RapidAPI, ranks by cosine similarity, and uses Claude API
to generate match justifications for top results.
"""

import os
import json
import re
import numpy as np
import requests
from pathlib import Path
from typing import Optional

from flask import Flask, request, jsonify
from pypdf import PdfReader
from sentence_transformers import SentenceTransformer
from anthropic import Anthropic
from dotenv import load_dotenv
import chromadb

load_dotenv()

app = Flask(__name__)

# ─── Configuration ───────────────────────────────────────────────────────────

MODEL_NAME = os.getenv("MODEL_NAME", "all-MiniLM-L6-v2")
ADZUNA_APP_ID = os.getenv("ADZUNA_APP_ID")
ADZUNA_API_KEY = os.getenv("ADZUNA_API_KEY")
JSEARCH_API_KEY = os.getenv("JSEARCH_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
PORT = int(os.getenv("PORT", "5000"))

# Load embedding model once at startup
print(f"Loading embedding model: {MODEL_NAME}...")
model = SentenceTransformer(MODEL_NAME)
print("Model loaded.")

# ChromaDB persistent vector store
CHROMA_DIR = os.getenv("CHROMA_DIR", "./chroma_data")
print(f"Initializing ChromaDB at: {CHROMA_DIR}")
chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)

# Collections for jobs and resumes
jobs_collection = chroma_client.get_or_create_collection(
    name="jobs",
    metadata={"description": "Job listings with embeddings for similarity search"},
)
resumes_collection = chroma_client.get_or_create_collection(
    name="resumes",
    metadata={"description": "Resume embeddings keyed by session ID"},
)
print(f"ChromaDB ready. Jobs: {jobs_collection.count()}, Resumes: {resumes_collection.count()}")

# Anthropic client (lazy init)
_anthropic: Optional[Anthropic] = None


def get_anthropic() -> Anthropic:
    global _anthropic
    if _anthropic is None:
        if not ANTHROPIC_API_KEY:
            raise ValueError("ANTHROPIC_API_KEY not set")
        _anthropic = Anthropic(api_key=ANTHROPIC_API_KEY)
    return _anthropic


# ─── Resume parsing ──────────────────────────────────────────────────────────


def extract_text_from_pdf(pdf_path: str) -> str:
    """Extract all text from a PDF file using pypdf."""
    reader = PdfReader(pdf_path)
    text_parts = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            text_parts.append(text)
    return "\n".join(text_parts)


def extract_keywords(resume_text: str) -> list[str]:
    """Extract meaningful keywords from resume text.

    Uses a simple heuristic: find capitalized multi-word phrases,
    technical terms, and common skill patterns.
    """
    # Common technical skills and frameworks to look for
    tech_patterns = [
        r"\b(?:Python|Java|JavaScript|TypeScript|React|Angular|Vue|Node\.js|"
        r"SQL|PostgreSQL|MongoDB|AWS|Azure|GCP|Docker|Kubernetes|Git|"
        r"Machine Learning|Deep Learning|NLP|Data Science|DevOps|CI/CD|"
        r"REST|GraphQL|Microservices|Agile|Scrum|TDD|"
        r"C\+\+|C#|Go|Rust|Swift|Kotlin|Ruby|PHP|Scala|R|"
        r"TensorFlow|PyTorch|Pandas|NumPy|Spark|Hadoop|Kafka|"
        r"Redis|Elasticsearch|RabbitMQ|Terraform|Ansible|"
        r"Figma|Sketch|UI/UX|Product Management|Project Management)\b"
    ]

    keywords = set()

    # Extract tech skills
    for pattern in tech_patterns:
        matches = re.findall(pattern, resume_text, re.IGNORECASE)
        keywords.update(m.strip() for m in matches)

    # Extract job titles (common patterns)
    title_pattern = r"\b(?:Senior |Lead |Staff |Principal |Junior |Associate )?" \
                    r"(?:Software|Data|Product|Full[- ]?Stack|Front[- ]?End|Back[- ]?End|ML|AI|Cloud|DevOps|QA|" \
                    r"Mobile|iOS|Android|Security|Network|Systems?|Platform|Site Reliability)" \
                    r"(?:\s+(?:Engineer|Developer|Scientist|Analyst|Manager|Architect|Designer|Consultant))s?\b"
    title_matches = re.findall(title_pattern, resume_text, re.IGNORECASE)
    keywords.update(m.strip() for m in title_matches)

    # Remove very short or common words
    keywords = {k for k in keywords if len(k) > 2}

    return sorted(keywords)


# ─── Job fetching ────────────────────────────────────────────────────────────


def fetch_adzuna_jobs(query: str, location: str = "", count: int = 20) -> list[dict]:
    """Fetch jobs from Adzuna API."""
    if not ADZUNA_APP_ID or not ADZUNA_API_KEY:
        return []

    params = {
        "app_id": ADZUNA_APP_ID,
        "app_key": ADZUNA_API_KEY,
        "results_per_page": count,
        "what": query,
        "content-type": "application/json",
    }
    if location:
        params["where"] = location

    try:
        resp = requests.get(
            "https://api.adzuna.com/v1/api/jobs/us/search/1",
            params=params,
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()

        return [
            {
                "title": job.get("title", ""),
                "company": job.get("company", {}).get("display_name", ""),
                "location": job.get("location", {}).get("display_name", ""),
                "description": job.get("description", "")[:500],
                "url": job.get("redirect_url", ""),
                "salary_min": job.get("salary_min"),
                "salary_max": job.get("salary_max"),
                "source": "adzuna",
                "posted_date": job.get("created", ""),
            }
            for job in data.get("results", [])
        ]
    except Exception as e:
        print(f"Adzuna fetch error: {e}")
        return []


def fetch_jsearch_jobs(query: str, location: str = "", count: int = 20) -> list[dict]:
    """Fetch jobs from JSearch (RapidAPI)."""
    if not JSEARCH_API_KEY:
        return []

    search_query = f"{query} {location}".strip() if location else query

    try:
        resp = requests.get(
            "https://jsearch.p.rapidapi.com/search",
            params={
                "query": search_query,
                "page": "1",
                "num_pages": "1",
            },
            headers={
                "X-RapidAPI-Key": JSEARCH_API_KEY,
                "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()

        return [
            {
                "title": job.get("job_title", ""),
                "company": job.get("employer_name", ""),
                "location": job.get("job_city", "") or job.get("job_country", ""),
                "description": (job.get("job_description", "") or "")[:500],
                "url": job.get("job_apply_link", "") or job.get("job_google_link", ""),
                "salary_min": job.get("job_min_salary"),
                "salary_max": job.get("job_max_salary"),
                "source": "jsearch",
                "posted_date": job.get("job_posted_at_datetime_utc", ""),
            }
            for job in data.get("data", [])[:count]
        ]
    except Exception as e:
        print(f"JSearch fetch error: {e}")
        return []


def fetch_jobs(query: str, location: str = "", count: int = 20) -> list[dict]:
    """Fetch jobs from all sources and deduplicate."""
    adzuna = fetch_adzuna_jobs(query, location, count)
    jsearch = fetch_jsearch_jobs(query, location, count)

    # Deduplicate by (company, title) normalized
    seen = set()
    results = []
    for job in adzuna + jsearch:
        key = (job["company"].lower().strip(), job["title"].lower().strip())
        if key not in seen and job["title"]:
            seen.add(key)
            results.append(job)

    return results[:count]


# ─── Embedding & similarity ─────────────────────────────────────────────────


def compute_cosine_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
    """Compute cosine similarity between two vectors."""
    norm_a = np.linalg.norm(vec_a)
    norm_b = np.linalg.norm(vec_b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(vec_a, vec_b) / (norm_a * norm_b))


def store_job_embedding(job: dict, embedding: np.ndarray) -> None:
    """Cache a job's embedding in ChromaDB for future similarity searches."""
    job_id = f"{job.get('company', '')}_{job.get('title', '')}_{job.get('source', '')}".lower().replace(" ", "_")[:200]
    try:
        jobs_collection.upsert(
            ids=[job_id],
            embeddings=[embedding.tolist()],
            metadatas=[{
                "title": job.get("title", ""),
                "company": job.get("company", ""),
                "location": job.get("location", ""),
                "url": job.get("url", ""),
                "source": job.get("source", ""),
                "posted_date": job.get("posted_date", ""),
            }],
            documents=[f"{job.get('title', '')} at {job.get('company', '')}. {job.get('description', '')[:300]}"],
        )
    except Exception as e:
        print(f"ChromaDB store error: {e}")


def store_resume_embedding(session_id: str, resume_text: str, embedding: np.ndarray) -> None:
    """Cache a resume embedding in ChromaDB keyed by session."""
    try:
        resumes_collection.upsert(
            ids=[session_id],
            embeddings=[embedding.tolist()],
            documents=[resume_text[:2000]],
            metadatas=[{"session_id": session_id}],
        )
    except Exception as e:
        print(f"ChromaDB resume store error: {e}")


def find_similar_jobs_from_history(resume_embedding: np.ndarray, n_results: int = 10) -> list[dict]:
    """Query ChromaDB for historically similar jobs."""
    try:
        results = jobs_collection.query(
            query_embeddings=[resume_embedding.tolist()],
            n_results=min(n_results, jobs_collection.count() or 1),
        )
        if not results or not results["metadatas"]:
            return []

        similar = []
        for i, meta in enumerate(results["metadatas"][0]):
            similar.append({
                **meta,
                "description": results["documents"][0][i] if results["documents"] else "",
                "match_score": round((1 - (results["distances"][0][i] if results["distances"] else 1)) * 100, 1),
                "source": meta.get("source", "history"),
            })
        return similar
    except Exception as e:
        print(f"ChromaDB query error: {e}")
        return []


def rank_jobs_by_similarity(
    resume_text: str, jobs: list[dict], session_id: str = ""
) -> list[dict]:
    """Rank jobs by cosine similarity between resume and job description embeddings.
    Also caches embeddings in ChromaDB for future queries."""
    if not jobs:
        return []

    # Create text representations
    job_texts = [
        f"{j['title']} at {j['company']}. {j['description']}" for j in jobs
    ]

    # Encode resume and all jobs in one batch
    all_texts = [resume_text] + job_texts
    embeddings = model.encode(all_texts, show_progress_bar=False)

    resume_embedding = embeddings[0]
    job_embeddings = embeddings[1:]

    # Cache resume embedding
    if session_id:
        store_resume_embedding(session_id, resume_text, resume_embedding)

    # Compute similarities and cache job embeddings
    for i, job in enumerate(jobs):
        similarity = compute_cosine_similarity(resume_embedding, job_embeddings[i])
        job["match_score"] = round(similarity * 100, 1)
        # Cache in ChromaDB
        store_job_embedding(job, job_embeddings[i])

    # Sort by score descending
    jobs.sort(key=lambda j: j["match_score"], reverse=True)
    return jobs


# ─── Claude match justification ─────────────────────────────────────────────


def generate_match_justifications(
    resume_text: str, top_jobs: list[dict], max_jobs: int = 5
) -> list[dict]:
    """Use Claude API to generate match justifications for top results."""
    if not ANTHROPIC_API_KEY or not top_jobs:
        return top_jobs

    jobs_to_justify = top_jobs[:max_jobs]

    jobs_text = "\n\n".join(
        f"Job {i+1}: {j['title']} at {j['company']} (score: {j['match_score']})\n"
        f"Description: {j['description'][:300]}"
        for i, j in enumerate(jobs_to_justify)
    )

    try:
        client = get_anthropic()
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            messages=[
                {
                    "role": "user",
                    "content": f"""Analyze why each job is a good or bad match for this candidate.

Resume (first 1000 chars):
{resume_text[:1000]}

Top job matches:
{jobs_text}

For each job, return a JSON array with:
[{{"index": 0, "justification": "2-3 sentence explanation of fit", "strengths": ["skill1", "skill2"], "gaps": ["missing1"]}}]

Return ONLY valid JSON. Be specific and honest.""",
                }
            ],
        )

        text = response.content[0].text if response.content[0].type == "text" else "[]"

        # Try to extract JSON from response
        json_match = re.search(r"\[.*\]", text, re.DOTALL)
        if json_match:
            justifications = json.loads(json_match.group())

            for j_data in justifications:
                idx = j_data.get("index", -1)
                if 0 <= idx < len(jobs_to_justify):
                    jobs_to_justify[idx]["justification"] = j_data.get("justification", "")
                    jobs_to_justify[idx]["strengths"] = j_data.get("strengths", [])
                    jobs_to_justify[idx]["gaps"] = j_data.get("gaps", [])
    except Exception as e:
        print(f"Claude justification error: {e}")
        # Continue without justifications — not critical

    return top_jobs


# ─── API Routes ──────────────────────────────────────────────────────────────


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({
        "status": "ok",
        "model": MODEL_NAME,
        "adzuna_configured": bool(ADZUNA_APP_ID and ADZUNA_API_KEY),
        "jsearch_configured": bool(JSEARCH_API_KEY),
        "claude_configured": bool(ANTHROPIC_API_KEY),
        "chromadb": {
            "jobs_count": jobs_collection.count(),
            "resumes_count": resumes_collection.count(),
        },
    })


@app.route("/parse-resume", methods=["POST"])
def parse_resume():
    """Parse a PDF resume and extract text + keywords.

    Accepts multipart/form-data with a 'file' field (PDF),
    or JSON with a 'path' field (local file path).
    """
    resume_text = ""

    if "file" in request.files:
        # File upload
        file = request.files["file"]
        if not file.filename or not file.filename.lower().endswith(".pdf"):
            return jsonify({"error": "Please upload a PDF file"}), 400

        # Save temporarily
        tmp_path = f"/tmp/resume_{os.getpid()}.pdf"
        file.save(tmp_path)
        try:
            resume_text = extract_text_from_pdf(tmp_path)
        finally:
            os.unlink(tmp_path)
    elif request.is_json:
        data = request.get_json()
        pdf_path = data.get("path", "")
        if not pdf_path or not Path(pdf_path).exists():
            return jsonify({"error": "PDF file not found at the provided path"}), 400
        resume_text = extract_text_from_pdf(pdf_path)
    else:
        return jsonify({"error": "Provide a PDF file or a path to one"}), 400

    if not resume_text.strip():
        return jsonify({"error": "Could not extract text from PDF"}), 400

    keywords = extract_keywords(resume_text)

    return jsonify({
        "text": resume_text,
        "keywords": keywords,
        "word_count": len(resume_text.split()),
    })


@app.route("/match", methods=["POST"])
def match_jobs():
    """Main endpoint: parse resume, fetch jobs, rank by similarity, justify with Claude.

    Accepts multipart/form-data with:
    - file: PDF resume (required)
    - query: Job search query (optional, derived from keywords if not provided)
    - location: Job location filter (optional)
    - count: Max jobs to fetch (default 20)
    - min_score: Minimum match score to return (default 0)
    - justify: Whether to generate Claude justifications (default true)
    """
    # Parse resume
    resume_text = ""

    if "file" in request.files:
        file = request.files["file"]
        if not file.filename or not file.filename.lower().endswith(".pdf"):
            return jsonify({"error": "Please upload a PDF file"}), 400

        tmp_path = f"/tmp/resume_{os.getpid()}.pdf"
        file.save(tmp_path)
        try:
            resume_text = extract_text_from_pdf(tmp_path)
        finally:
            os.unlink(tmp_path)
    elif request.is_json:
        data = request.get_json()
        if "resume_text" in data:
            resume_text = data["resume_text"]
        elif "path" in data:
            resume_text = extract_text_from_pdf(data["path"])

    if not resume_text.strip():
        return jsonify({"error": "Could not extract resume text"}), 400

    # Get parameters
    query = request.form.get("query", "") or (request.get_json() or {}).get("query", "")
    location = request.form.get("location", "") or (request.get_json() or {}).get("location", "")
    count = int(request.form.get("count", "20") or (request.get_json() or {}).get("count", 20))
    min_score = float(request.form.get("min_score", "0") or (request.get_json() or {}).get("min_score", 0))
    justify = request.form.get("justify", "true").lower() != "false"

    # Extract keywords if no query provided
    keywords = extract_keywords(resume_text)
    if not query:
        # Use top keywords as search query
        query = " ".join(keywords[:5]) if keywords else "software engineer"

    # Fetch jobs
    jobs = fetch_jobs(query, location, count)

    if not jobs:
        return jsonify({
            "jobs": [],
            "query": query,
            "keywords": keywords,
            "message": "No jobs found. Try different keywords or location.",
        })

    # Get session_id for ChromaDB caching
    session_id = request.form.get("session_id", "") or (request.get_json() or {}).get("session_id", "")

    # Rank by embedding similarity (also caches in ChromaDB)
    ranked_jobs = rank_jobs_by_similarity(resume_text, jobs, session_id)

    # Filter by minimum score
    if min_score > 0:
        ranked_jobs = [j for j in ranked_jobs if j.get("match_score", 0) >= min_score]

    # Generate Claude justifications for top results
    if justify and ANTHROPIC_API_KEY:
        ranked_jobs = generate_match_justifications(resume_text, ranked_jobs)

    return jsonify({
        "jobs": ranked_jobs,
        "query": query,
        "keywords": keywords,
        "total_fetched": len(jobs),
        "total_returned": len(ranked_jobs),
    })


@app.route("/similarity", methods=["POST"])
def compute_similarity():
    """Compute similarity between resume text and a specific job description.

    Accepts JSON with:
    - resume_text: The resume text
    - job_description: The job description text
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "JSON body required"}), 400

    resume_text = data.get("resume_text", "")
    job_description = data.get("job_description", "")

    if not resume_text or not job_description:
        return jsonify({"error": "Both resume_text and job_description are required"}), 400

    embeddings = model.encode([resume_text, job_description], show_progress_bar=False)
    similarity = compute_cosine_similarity(embeddings[0], embeddings[1])

    return jsonify({
        "similarity": round(similarity, 4),
        "match_score": round(similarity * 100, 1),
    })


@app.route("/similar", methods=["GET"])
def find_similar():
    """Find similar jobs from ChromaDB history based on a session's resume.

    Query params:
    - session_id: Session ID to look up the cached resume embedding (required)
    - count: Number of similar jobs to return (default 10)
    """
    session_id = request.args.get("session_id", "")
    count = int(request.args.get("count", "10"))

    if not session_id:
        return jsonify({"error": "session_id parameter is required"}), 400

    if jobs_collection.count() == 0:
        return jsonify({"jobs": [], "message": "No jobs in history yet. Run /match first."})

    # Try to get cached resume embedding from ChromaDB
    try:
        result = resumes_collection.get(ids=[session_id], include=["embeddings"])
        if not result["embeddings"] or len(result["embeddings"]) == 0:
            return jsonify({"error": "No cached resume found for this session. Run /match first."}), 404

        resume_embedding = np.array(result["embeddings"][0])
        similar_jobs = find_similar_jobs_from_history(resume_embedding, count)

        return jsonify({
            "jobs": similar_jobs,
            "count": len(similar_jobs),
            "session_id": session_id,
            "total_jobs_in_history": jobs_collection.count(),
        })
    except Exception as e:
        return jsonify({"error": f"Failed to find similar jobs: {str(e)}"}), 500


@app.route("/history/stats", methods=["GET"])
def history_stats():
    """Return stats about the ChromaDB vector store."""
    return jsonify({
        "jobs_stored": jobs_collection.count(),
        "resumes_stored": resumes_collection.count(),
    })


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"Starting RAG Matcher on port {PORT}...")
    print(f"  Adzuna: {'configured' if ADZUNA_APP_ID else 'NOT configured'}")
    print(f"  JSearch: {'configured' if JSEARCH_API_KEY else 'NOT configured'}")
    print(f"  Claude: {'configured' if ANTHROPIC_API_KEY else 'NOT configured'}")
    print(f"  Model: {MODEL_NAME}")
    app.run(host="0.0.0.0", port=PORT, debug=True)
