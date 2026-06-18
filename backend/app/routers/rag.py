import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth_middleware import get_current_user
from app.models.user import User
from app.models.rag_document import RAGDocument
from app.services import rag_service
from app.services.channel_service import get_channel_by_id

router = APIRouter()


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_document(
    channel_id: uuid.UUID = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a document to be chunked and indexed for RAG Q&A in a channel."""
    # Verify channel exists
    channel = await get_channel_by_id(db, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
        
    filename = file.filename or "uploaded_file"
    ext = filename.split(".")[-1].lower()
    if ext not in ["txt", "md", "pdf"]:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file format. Only .txt, .md, and .pdf are supported."
        )
        
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="File size exceeds the maximum limit of 10MB."
        )
        
    try:
        doc = await rag_service.store_document(
            db=db,
            filename=filename,
            channel_id=channel_id,
            user_id=current_user.id,
            file_bytes=content
        )
        return {
            "id": str(doc.id),
            "filename": doc.filename,
            "file_size": doc.file_size,
            "created_at": doc.created_at.isoformat()
        }
    except Exception as e:
        print(f"RAG Document upload failure: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to process and index document. Please verify your document format is valid and check your Gemini API key configuration in .env."
        )


@router.get("/documents/{channel_id}")
async def list_documents(
    channel_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all RAG documents uploaded to a specific channel."""
    # Verify channel exists
    channel = await get_channel_by_id(db, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
        
    stmt = (
        select(RAGDocument)
        .where(RAGDocument.channel_id == channel_id)
        .order_by(RAGDocument.created_at.desc())
    )
    res = await db.execute(stmt)
    docs = res.scalars().all()
    
    return [
        {
            "id": str(doc.id),
            "filename": doc.filename,
            "file_size": doc.file_size,
            "created_at": doc.created_at.isoformat()
        }
        for doc in docs
    ]


@router.delete("/documents/{document_id}")
async def delete_document(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a document and all its indexed chunks from the workspace."""
    stmt = select(RAGDocument).where(RAGDocument.id == document_id)
    res = await db.execute(stmt)
    doc = res.scalar_one_or_none()
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
        
    # Optional: Verify if user has permissions (e.g. uploader or incident channel admin)
    await db.delete(doc)
    await db.commit()
    return {"message": "Document deleted successfully"}


from pydantic import BaseModel

class RAGChatRequest(BaseModel):
    channel_id: uuid.UUID
    question: str


@router.post("/chat")
async def chat_with_document(
    payload: RAGChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ask a question about documents uploaded to a specific channel."""
    # Verify channel exists
    channel = await get_channel_by_id(db, payload.channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
        
    if not payload.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
        
    try:
        response = await rag_service.answer_rag_question(
            db=db,
            channel_id=payload.channel_id,
            question=payload.question
        )
        return response
    except Exception as e:
        print(f"RAG Chat failure: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="AI Document Search is temporarily unavailable. Please verify that a valid Gemini API key is configured in your backend .env file."
        )
