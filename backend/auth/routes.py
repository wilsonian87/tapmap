from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import aiosqlite

from db.database import get_db
from auth.security import (
    hash_password,
    verify_password,
    create_session_token,
    get_current_user,
)
from config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str


@router.post("/register")
async def register(body: RegisterRequest, db: aiosqlite.Connection = Depends(get_db)):
    # Check if username exists
    cursor = await db.execute(
        "SELECT id FROM users WHERE username = ?", (body.username,)
    )
    if await cursor.fetchone():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already exists",
        )

    pw_hash = hash_password(body.password)
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
        (body.username, pw_hash),
    )
    await db.commit()

    token = create_session_token(cursor.lastrowid, body.username)
    response = JSONResponse(
        content={"username": body.username, "message": "Registered successfully"}
    )
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=settings.session_max_age,
    )
    return response


@router.post("/login")
async def login(body: LoginRequest, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute(
        "SELECT id, username, password_hash FROM users WHERE username = ?",
        (body.username,),
    )
    row = await cursor.fetchone()
    if not row or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    # Update last login
    await db.execute(
        "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?",
        (row["id"],),
    )
    await db.commit()

    token = create_session_token(row["id"], row["username"])
    response = JSONResponse(
        content={"username": row["username"], "message": "Logged in"}
    )
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=settings.session_max_age,
    )
    return response


@router.post("/logout")
async def logout():
    response = JSONResponse(content={"message": "Logged out"})
    response.delete_cookie(key=settings.session_cookie_name)
    return response


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return {"username": user["username"], "user_id": user["user_id"]}
