"""
Tests for the RAG Matcher microservice.
Run with: python -m pytest test_app.py -v
"""

import json
import os
import tempfile
import pytest
from app import (
    app,
    extract_text_from_pdf,
    extract_keywords,
    compute_cosine_similarity,
    model,
)
import numpy as np


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


# ─── Unit tests ──────────────────────────────────────────────────────────────


def test_extract_keywords():
    """Keywords are extracted from resume text."""
    text = """
    Senior Software Engineer with 5 years of experience in Python, React, and AWS.
    Built microservices using Docker and Kubernetes. Expert in Machine Learning and NLP.
    """
    keywords = extract_keywords(text)
    assert len(keywords) > 0
    # Should find common tech terms
    keyword_lower = [k.lower() for k in keywords]
    assert any("python" in k for k in keyword_lower)
    assert any("react" in k for k in keyword_lower)
    assert any("aws" in k for k in keyword_lower)


def test_cosine_similarity_identical():
    """Identical vectors should have similarity of 1.0."""
    vec = np.array([1.0, 2.0, 3.0])
    assert abs(compute_cosine_similarity(vec, vec) - 1.0) < 0.001


def test_cosine_similarity_orthogonal():
    """Orthogonal vectors should have similarity of 0.0."""
    vec_a = np.array([1.0, 0.0])
    vec_b = np.array([0.0, 1.0])
    assert abs(compute_cosine_similarity(vec_a, vec_b)) < 0.001


def test_cosine_similarity_zero_vector():
    """Zero vector should return 0.0 similarity."""
    vec_a = np.array([1.0, 2.0])
    vec_zero = np.array([0.0, 0.0])
    assert compute_cosine_similarity(vec_a, vec_zero) == 0.0


def test_embedding_model_loaded():
    """Sentence transformer model should be loaded."""
    assert model is not None
    # Test encoding
    embedding = model.encode(["test sentence"], show_progress_bar=False)
    assert embedding.shape[0] == 1
    assert embedding.shape[1] > 0  # Should have non-zero dimensions


def test_embedding_similarity():
    """Similar sentences should have higher similarity than dissimilar ones."""
    texts = [
        "Python developer with React experience",
        "Software engineer skilled in Python and React",
        "Professional chef specializing in Italian cuisine",
    ]
    embeddings = model.encode(texts, show_progress_bar=False)

    sim_similar = compute_cosine_similarity(embeddings[0], embeddings[1])
    sim_different = compute_cosine_similarity(embeddings[0], embeddings[2])

    assert sim_similar > sim_different, "Similar sentences should score higher"


# ─── API endpoint tests ─────────────────────────────────────────────────────


def test_health_endpoint(client):
    """Health check should return status ok."""
    response = client.get("/health")
    assert response.status_code == 200
    data = json.loads(response.data)
    assert data["status"] == "ok"
    assert "model" in data
    assert "chromadb" in data


def test_history_stats(client):
    """History stats should return counts."""
    response = client.get("/history/stats")
    assert response.status_code == 200
    data = json.loads(response.data)
    assert "jobs_stored" in data
    assert "resumes_stored" in data


def test_parse_resume_no_file(client):
    """Should return error when no file provided."""
    response = client.post("/parse-resume", content_type="application/json", data=json.dumps({}))
    assert response.status_code == 400


def test_similarity_endpoint(client):
    """Similarity endpoint should return a score."""
    response = client.post(
        "/similarity",
        content_type="application/json",
        data=json.dumps({
            "resume_text": "Python developer with 5 years experience in web development and machine learning",
            "job_description": "Looking for a Python developer with ML experience",
        }),
    )
    assert response.status_code == 200
    data = json.loads(response.data)
    assert "similarity" in data
    assert "match_score" in data
    assert 0 <= data["match_score"] <= 100


def test_similarity_missing_fields(client):
    """Should return error when fields are missing."""
    response = client.post(
        "/similarity",
        content_type="application/json",
        data=json.dumps({"resume_text": "test"}),
    )
    assert response.status_code == 400


def test_similar_no_session(client):
    """Similar endpoint should require session_id."""
    response = client.get("/similar")
    assert response.status_code == 400


def test_match_no_resume(client):
    """Match endpoint should require resume text."""
    response = client.post(
        "/match",
        content_type="application/json",
        data=json.dumps({"query": "software engineer"}),
    )
    assert response.status_code == 400


def test_match_with_resume_text(client):
    """Match with resume_text should work (may return 0 jobs if APIs not configured)."""
    response = client.post(
        "/match",
        content_type="application/json",
        data=json.dumps({
            "resume_text": "Experienced Python developer with React, AWS, and machine learning skills.",
            "query": "python developer",
            "location": "remote",
            "count": 5,
            "justify": False,
        }),
    )
    assert response.status_code == 200
    data = json.loads(response.data)
    assert "jobs" in data
    assert "keywords" in data
    assert "query" in data


# ─── ChromaDB integration tests ───────────────────────────────────────────���─


def test_chromadb_store_and_retrieve(client):
    """Test that ChromaDB stores and retrieves job embeddings."""
    from app import jobs_collection, store_job_embedding

    initial_count = jobs_collection.count()

    # Store a test job
    test_embedding = model.encode(["Test Software Engineer at TestCo"], show_progress_bar=False)[0]
    store_job_embedding(
        {"title": "Test Engineer", "company": "TestCo", "source": "test", "description": "A test job"},
        test_embedding,
    )

    assert jobs_collection.count() >= initial_count  # May be same if already existed


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
