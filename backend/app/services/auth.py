"""Auth domain logic: user creation and credential verification."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.models.resource import Space
from app.models.user import User
from app.models.workspace import MemberRole, Workspace, WorkspaceMember
from app.schemas.auth import SignupRequest


class EmailAlreadyExistsError(Exception):
    """Raised when signing up with an email that is already registered."""


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def create_user(db: AsyncSession, payload: SignupRequest) -> User:
    if await get_user_by_email(db, payload.email) is not None:
        raise EmailAlreadyExistsError(payload.email)

    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
    )
    db.add(user)
    await db.flush()

    # Every new user gets a personal workspace they own.
    ws_name = f"{payload.full_name or payload.email.split('@')[0]}'s Workspace"
    workspace = Workspace(name=ws_name)
    db.add(workspace)
    await db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=MemberRole.owner))
    db.add(Space(workspace_id=workspace.id, name="General", order=0))

    await db.commit()
    await db.refresh(user)
    return user


async def authenticate_user(db: AsyncSession, email: str, password: str) -> User | None:
    user = await get_user_by_email(db, email)
    if user is None or not verify_password(password, user.hashed_password):
        return None
    return user
