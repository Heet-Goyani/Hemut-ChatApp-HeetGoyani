import uuid
import pytest
from unittest.mock import patch
from httpx import AsyncClient

from app.services.rag_service import (
    chunk_text,
    calculate_cosine_similarity,
    extract_text_from_file,
    generate_embedding
)


# ── Unit tests ──────────────────────────────────────────────────────

def test_extract_text_from_file():
    txt_content = b"This is a text content for RAG."
    res = extract_text_from_file(txt_content, "deal.txt")
    assert res == "This is a text content for RAG."


def test_chunk_text():
    content = "A" * 1200
    chunks = chunk_text(content, chunk_size=500, overlap=50)
    assert len(chunks) > 1
    assert len(chunks[0]) == 500


def test_cosine_similarity():
    v1 = [1.0, 0.0, 0.0]
    v2 = [1.0, 0.0, 0.0]
    assert calculate_cosine_similarity(v1, v2) == pytest.approx(1.0)
    
    v3 = [0.0, 1.0, 0.0]
    assert calculate_cosine_similarity(v1, v3) == pytest.approx(0.0)


@pytest.mark.asyncio
async def test_generate_embedding_mock():
    with patch("app.services.rag_service.settings.GEMINI_API_KEY", "mock"):
        emb = await generate_embedding("sample text query")
    assert len(emb) == 768
    assert isinstance(emb[0], float)


# ── Integration / API Router tests ──────────────────────────────────

@pytest.mark.asyncio
async def test_rag_endpoints_lifecycle(client: AsyncClient, auth_headers: dict):
    with patch("app.services.rag_service.settings.GEMINI_API_KEY", "mock"):
        # 1. Create a channel
        ch_resp = await client.post(
            "/api/channels",
            json={"name": "rag-test-channel"},
            headers=auth_headers,
        )
        assert ch_resp.status_code == 201
        channel_id = ch_resp.json()["id"]
    
        # 2. Upload text file
        file_payload = {"file": ("logistics_deal.txt", b"Dubai shipment terminal coordinates. The gate code is 9876.", "text/plain")}
        upload_resp = await client.post(
            "/api/rag/upload",
            data={"channel_id": channel_id},
            files=file_payload,
            headers=auth_headers
        )
        assert upload_resp.status_code == 201
        doc_id = upload_resp.json()["id"]
        assert upload_resp.json()["filename"] == "logistics_deal.txt"
    
        # 3. List documents in channel
        list_resp = await client.get(
            f"/api/rag/documents/{channel_id}",
            headers=auth_headers
        )
        assert list_resp.status_code == 200
        docs = list_resp.json()
        assert len(docs) == 1
        assert docs[0]["id"] == doc_id
    
        # 4. Ask a question (Chat RAG)
        chat_resp = await client.post(
            "/api/rag/chat",
            json={
                "channel_id": channel_id,
                "question": "What is the gate code for Dubai terminal?"
            },
            headers=auth_headers
        )
        assert chat_resp.status_code == 200
        answer_data = chat_resp.json()
        assert "answer" in answer_data
        assert len(answer_data["sources"]) > 0
        assert answer_data["sources"][0]["filename"] == "logistics_deal.txt"
    
        # 5. Delete the document
        del_resp = await client.delete(
            f"/api/rag/documents/{doc_id}",
            headers=auth_headers
        )
        assert del_resp.status_code == 200
    
        # 6. List documents again (should be empty)
        list_empty = await client.get(
            f"/api/rag/documents/{channel_id}",
            headers=auth_headers
        )
        assert list_empty.status_code == 200
        assert len(list_empty.json()) == 0
