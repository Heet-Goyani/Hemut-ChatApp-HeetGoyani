import io
import math
import uuid
import httpx
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from pypdf import PdfReader

from app.config import settings
from app.models.rag_document import RAGDocument, RAGDocumentChunk


def extract_text_from_file(file_bytes: bytes, filename: str) -> str:
    """Extract text from TXT, MD, or PDF file bytes."""
    ext = filename.split(".")[-1].lower()
    if ext == "pdf":
        try:
            reader = PdfReader(io.BytesIO(file_bytes))
            text_parts = []
            for page in reader.pages:
                t = page.extract_text()
                if t:
                    text_parts.append(t)
            return "\n".join(text_parts)
        except Exception as e:
            raise ValueError(f"Failed to parse PDF file: {str(e)}")
    else:
        # Default to UTF-8 text decoding
        try:
            return file_bytes.decode("utf-8", errors="ignore")
        except Exception as e:
            raise ValueError(f"Failed to read text file: {str(e)}")


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """Split text into overlapping chunks of character count."""
    chunks = []
    if not text:
        return chunks
    
    start = 0
    text_len = len(text)
    while start < text_len:
        end = min(start + chunk_size, text_len)
        chunks.append(text[start:end])
        start += chunk_size - overlap
        if start >= end: # Prevent infinite loop if overlap >= chunk_size
            break
            
    return [c.strip() for c in chunks if c.strip()]


async def generate_embedding(text: str) -> list[float]:
    """Generate a 768-dimension embedding vector from text using Gemini API."""
    # Fallback mock embedding for local/dummy key testing
    is_dummy = (
        not settings.GEMINI_API_KEY 
        or settings.GEMINI_API_KEY.startswith("dummy") 
        or settings.GEMINI_API_KEY == "mock"
    )
    
    if is_dummy:
        # Create a deterministic mock vector of 768 dims based on string hash
        vec = []
        h = hash(text)
        for i in range(768):
            val = math.sin(h + i) * 0.1
            vec.append(val)
        return vec

    url = f"https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key={settings.GEMINI_API_KEY}"
    payload = {
        "content": {
            "parts": [
                {
                    "text": text
                }
            ]
        }
    }
    
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(url, json=payload, timeout=10.0)
            res.raise_for_status()
            data = res.json()
            return data["embedding"]["values"]
    except Exception as e:
        if not is_dummy:
            raise ValueError(f"Gemini embedding generation failed: {str(e)}")
        # Resilient fallback: return mock vector if API call fails
        vec = []
        h = hash(text)
        for i in range(768):
            val = math.sin(h + i) * 0.1
            vec.append(val)
        return vec


def calculate_cosine_similarity(v1: list[float], v2: list[float]) -> float:
    """Compute cosine similarity between two float vectors."""
    dot_product = sum(a * b for a, b in zip(v1, v2))
    norm1 = sum(a * a for a in v1) ** 0.5
    norm2 = sum(b * b for b in v2) ** 0.5
    if not norm1 or not norm2:
        return 0.0
    return dot_product / (norm1 * norm2)


async def store_document(
    db: AsyncSession,
    filename: str,
    channel_id: uuid.UUID | None,
    user_id: uuid.UUID,
    file_bytes: bytes
) -> RAGDocument:
    """Extract, chunk, embed, and store document in database."""
    text = extract_text_from_file(file_bytes, filename)
    chunks = chunk_text(text)
    
    doc = RAGDocument(
        filename=filename,
        channel_id=channel_id,
        user_id=user_id,
        file_size=len(file_bytes)
    )
    db.add(doc)
    await db.flush() # Populate doc.id
    
    for idx, content in enumerate(chunks):
        emb = await generate_embedding(content)
        chunk_rec = RAGDocumentChunk(
            document_id=doc.id,
            chunk_index=idx,
            content=content,
            embedding=emb
        )
        db.add(chunk_rec)
        
    await db.commit()
    await db.refresh(doc)
    return doc


async def query_documents(
    db: AsyncSession,
    channel_id: uuid.UUID | None,
    query_text: str,
    limit: int = 5
) -> list[tuple[RAGDocumentChunk, float]]:
    """Retrieve top-K chunks for a channel based on cosine similarity search in Python."""
    query_emb = await generate_embedding(query_text)
    
    # Fetch all chunks in this channel
    stmt = (
        select(RAGDocumentChunk)
        .join(RAGDocument)
        .where(RAGDocument.channel_id == channel_id)
        .options(selectinload(RAGDocumentChunk.document))
    )
    
    res = await db.execute(stmt)
    chunks = res.scalars().all()
    
    scored_chunks = []
    for c in chunks:
        score = calculate_cosine_similarity(query_emb, c.embedding)
        scored_chunks.append((c, score))
        
    # Sort descending by score
    scored_chunks.sort(key=lambda x: x[1], reverse=True)
    return scored_chunks[:limit]


async def answer_rag_question(
    db: AsyncSession,
    channel_id: uuid.UUID | None,
    question: str
) -> dict:
    """Find top chunks and synthesize an answer using gemini-3.5-flash."""
    top_results = await query_documents(db, channel_id, question, limit=4)
    
    if not top_results:
        return {
            "answer": "No documents have been uploaded to this channel yet. Please upload a document first to chat.",
            "sources": []
        }
        
    # Build prompt context
    context_parts = []
    sources = []
    for idx, (chunk, score) in enumerate(top_results):
        context_parts.append(f"Context [{idx+1}] (from {chunk.document.filename}):\n{chunk.content}")
        sources.append({
            "filename": chunk.document.filename,
            "chunk_index": chunk.chunk_index,
            "score": round(score, 3)
        })
        
    context_str = "\n\n".join(context_parts)
    
    system_prompt = (
        "You are a helpful logistics operations workspace assistant.\n"
        "Your task is to answer the user's question using only the provided context chunks extracted from documents uploaded in this channel.\n"
        "If you do not know the answer or the context doesn't contain it, explain that the uploaded documents don't specify that information.\n"
        "Keep your answer clear, accurate, and professional."
    )
    
    prompt = (
        f"{system_prompt}\n\n"
        f"CONTEXT CHUNKS:\n"
        f"{context_str}\n\n"
        f"USER QUESTION: {question}\n\n"
        f"Provide your answer below:"
    )

    # Call Gemini model
    is_dummy = (
        not settings.GEMINI_API_KEY 
        or settings.GEMINI_API_KEY.startswith("dummy") 
        or settings.GEMINI_API_KEY == "mock"
    )
    
    if not is_dummy:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key={settings.GEMINI_API_KEY}"
        payload = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": prompt
                        }
                    ]
                }
            ]
        }
        
        try:
            async with httpx.AsyncClient() as client:
                res = await client.post(url, json=payload, timeout=25.0)
                res.raise_for_status()
                res_data = res.json()
                answer = res_data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except Exception as e:
            if not is_dummy:
                raise ValueError(f"Gemini content generation failed: {str(e)}")
            answer = f"Error communicating with AI service: {str(e)}. Fallback to mock answering."
            is_dummy = True
            
    if is_dummy:
        # Dynamic mock answering using keyword matches
        matched_chunks = [c.content for c, s in top_results if any(w in c.content.lower() for w in question.lower().split())]
        if matched_chunks:
            answer = f"Mock RAG Answer (no active API key): Based on your question, I found relevant segments in '{top_results[0][0].document.filename}'. Details: \"{matched_chunks[0][:150]}...\""
        else:
            answer = f"Mock RAG Answer: I searched the uploaded documents (e.g. '{top_results[0][0].document.filename}') but did not find matching statements for your query. Here is a sample chunk content: \"{top_results[0][0].content[:150]}...\""
            
    return {
        "answer": answer,
        "sources": sources
    }
