import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, JSON, String, Text, UniqueConstraint, Uuid, func, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    projects: Mapped[list["Project"]] = relationship("Project", back_populates="owner", cascade="all, delete-orphan")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    bible_content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    outline_content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    owner: Mapped["User"] = relationship("User", back_populates="projects")
    chapters: Mapped[list["Chapter"]] = relationship("Chapter", back_populates="project", cascade="all, delete-orphan")
    documents: Mapped[list["Document"]] = relationship("Document", back_populates="project", cascade="all, delete-orphan")


class Chapter(Base):
    __tablename__ = "chapters"
    __table_args__ = (UniqueConstraint("project_id", "number", name="uq_chapter_project_number"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    number: Mapped[int] = mapped_column(nullable=False)
    plan: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    draft: Mapped[str | None] = mapped_column(Text, nullable=True)
    issues: Mapped[list | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    project: Mapped["Project"] = relationship("Project", back_populates="chapters")
    draft_state: Mapped["DraftState | None"] = relationship("DraftState", back_populates="chapter", uselist=False, cascade="all, delete-orphan")
    summary: Mapped["Summary | None"] = relationship("Summary", back_populates="chapter", uselist=False, cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"
    # One bible per project. Partial indexes work on both SQLite and PostgreSQL,
    # so the same declaration covers local dev and the Railway deployment.
    __table_args__ = (
        Index(
            "uq_documents_project_bible",
            "project_id",
            unique=True,
            sqlite_where=text("kind = 'bible'"),
            postgresql_where=text("kind = 'bible'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="Untitled")
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="chapter")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    brief: Mapped[str] = mapped_column(Text, nullable=False, default="")
    plan: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    issues: Mapped[list | None] = mapped_column(JSON, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    position: Mapped[int] = mapped_column(nullable=False, default=0)
    # server_default as well as default, so the migration's raw-SQL backfill and
    # the ORM agree. Without it, an INSERT that bypasses the ORM hits NOT NULL.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, server_default=func.now())

    project: Mapped["Project"] = relationship("Project", back_populates="documents")


class DraftState(Base):
    __tablename__ = "draft_states"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    chapter_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("chapters.id", ondelete="CASCADE"), unique=True, nullable=False)
    step: Mapped[str] = mapped_column(String(20), nullable=False)
    scene_plan: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    draft: Mapped[str | None] = mapped_column(Text, nullable=True)
    issues: Mapped[list | None] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    chapter: Mapped["Chapter"] = relationship("Chapter", back_populates="draft_state")


class Summary(Base):
    __tablename__ = "summaries"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    chapter_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("chapters.id", ondelete="CASCADE"), unique=True, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)

    chapter: Mapped["Chapter"] = relationship("Chapter", back_populates="summary")
