import os, sqlite3, hashlib, hmac, secrets, time
from pathlib import Path

DB_PATH = os.getenv("DATABASE_PATH", str(Path(__file__).parent / "navigation.db"))
DEMO_EMAIL = "demo@local"
DEMO_TOKEN = "demo-token"
# Simple opaque bearer tokens are stored in-process for this local MVP.
# For deployment, replace this with signed/rotating sessions or a maintained auth library.
TOKENS = {}


def get_or_create_demo_user():
    with connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE email=?", (DEMO_EMAIL,)).fetchone()
        if row:
            return {"id": row["id"], "email": row["email"], "created": time.time()}
        salt = secrets.token_hex(16)
        digest = hash_password("demo-access", salt)
        cur = conn.execute(
            "INSERT INTO users(email,salt,password_hash) VALUES(?,?,?)",
            (DEMO_EMAIL, salt, digest),
        )
        return {"id": cur.lastrowid, "email": DEMO_EMAIL, "created": time.time()}

def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with connect() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS trips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            source TEXT NOT NULL,
            destination TEXT NOT NULL,
            stops TEXT NOT NULL DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )""")

def hash_password(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 240000).hex()

def register_user(email, password):
    email = email.strip().lower()
    if "@" not in email or len(email) > 254:
        raise ValueError("Enter a valid email address.")
    salt = secrets.token_hex(16)
    digest = hash_password(password, salt)
    try:
        with connect() as conn:
            cur = conn.execute("INSERT INTO users(email,salt,password_hash) VALUES(?,?,?)", (email, salt, digest))
            user_id = cur.lastrowid
    except sqlite3.IntegrityError:
        raise ValueError("An account with this email already exists.")
    token = secrets.token_urlsafe(32)
    TOKENS[token] = {"id": user_id, "email": email, "created": time.time()}
    return {"token": token, "email": email}

def login_user(email, password):
    email = email.strip().lower()
    with connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not row or not hmac.compare_digest(hash_password(password, row["salt"]), row["password_hash"]):
        raise ValueError("Incorrect email or password.")
    token = secrets.token_urlsafe(32)
    TOKENS[token] = {"id": row["id"], "email": row["email"], "created": time.time()}
    return {"token": token, "email": row["email"]}

def get_user_from_token(token):
    if token == DEMO_TOKEN:
        return get_or_create_demo_user()
    user = TOKENS.get(token)
    if not user:
        return None
    if time.time() - user["created"] > 86400:
        TOKENS.pop(token, None)
        return None
    return user

def save_trip(user_id, title, source, destination, stops):
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO trips(user_id,title,source,destination,stops) VALUES(?,?,?,?,?)",
            (user_id, title[:120], source[:500], destination[:500], "\n".join(stops[:8]))
        )
        return {"id": cur.lastrowid, "message": "Journey saved."}

def list_trips(user_id):
    with connect() as conn:
        rows = conn.execute("SELECT id,title,source,destination,stops,created_at FROM trips WHERE user_id=? ORDER BY id DESC", (user_id,)).fetchall()
    return [dict(row) | {"stops": row["stops"].splitlines() if row["stops"] else []} for row in rows]
