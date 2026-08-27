import hashlib
import io
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path


TEST_ROOT = Path(tempfile.mkdtemp(prefix="hakkari-roll-tests-"))
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

os.environ.update(
    HAKKARI_ROLL_DB_PATH=str(TEST_ROOT / "test.db"),
    HAKKARI_ROLL_UPLOAD_DIR=str(TEST_ROOT / "uploads"),
    HAKKARI_ROLL_ADMIN_USERNAME="testadmin",
    HAKKARI_ROLL_ADMIN_PASSWORD="TestAdmin-Only-482!",
    HAKKARI_ROLL_PEPPER="test-pepper-not-for-production",
    HAKKARI_ROLL_PBKDF2_ITERATIONS="1000",
    HAKKARI_ROLL_LOGIN_MAX_ATTEMPTS="8",
    HAKKARI_ROLL_ENV="testing",
)

import hakkari_roll_server as server  # noqa: E402


class HakkariRollApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.app.config.update(TESTING=True)
        cls.client = server.app.test_client()
        response = cls.client.post(
            "/api/login",
            json={"username": "testadmin", "password": "TestAdmin-Only-482!"},
        )
        cls.admin_token = response.get_json()["token"]

    @classmethod
    def auth(cls, token=None):
        return {"Authorization": f"Bearer {token or cls.admin_token}"}

    @classmethod
    def set_registration_mode(cls, mode):
        response = cls.client.put(
            "/api/admin/settings",
            headers=cls.auth(),
            json={"registration_mode": mode, "daily_ip_registration_limit": 20},
        )
        assert response.status_code == 200

    def register(self, username, password="VerySafe-Password-42"):
        return self.client.post(
            "/api/register",
            json={
                "display_name": username.title(),
                "username": username,
                "password": password,
                "terms_accepted": True,
                "safety_accepted": True,
                "privacy_accepted": True,
                "location_accepted": True,
            },
        )

    def test_health_and_security_headers(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["database"], "ok")
        self.assertEqual(response.get_json()["version"], "5.0.0")
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response.headers["X-Frame-Options"], "DENY")

    def test_approval_mode_blocks_login_until_admin_approval(self):
        self.set_registration_mode("approval")
        response = self.register("pending_driver")
        data = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(data["pending_approval"])
        self.assertNotIn("token", data)

        blocked = self.client.post(
            "/api/login",
            json={"username": "pending_driver", "password": "VerySafe-Password-42"},
        )
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.get_json()["code"], "APPROVAL_REQUIRED")

        with server.db() as connection:
            user_id = connection.execute(
                "select id from users where username=?", ("pending_driver",)
            ).fetchone()["id"]
        approved = self.client.post(
            f"/api/admin/users/{user_id}/approve", headers=self.auth()
        )
        self.assertEqual(approved.status_code, 200)

        login = self.client.post(
            "/api/login",
            json={
                "username": "pending_driver",
                "password": "VerySafe-Password-42",
                "remember": True,
            },
        )
        self.assertEqual(login.status_code, 200)
        cookie = login.headers.get("Set-Cookie", "")
        self.assertIn("hr_session=", cookie)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        raw_token = login.get_json()["token"]
        with server.db() as connection:
            session = connection.execute(
                "select token,expires_at from sessions where user_id=? order by created_at desc limit 1",
                (user_id,),
            ).fetchone()
        self.assertEqual(session["token"], hashlib.sha256(raw_token.encode()).hexdigest())
        self.assertTrue(session["expires_at"])

    def test_public_user_payload_does_not_expose_email(self):
        self.set_registration_mode("open")
        owner = self.register("privacy_owner").get_json()
        viewer = self.register("privacy_viewer").get_json()
        with server.db() as connection:
            connection.execute(
                "update users set email=?,email_verified=1 where username=?",
                ("owner@example.test", "privacy_owner"),
            )
            connection.commit()

        listing = self.client.get("/api/users", headers=self.auth(viewer["token"]))
        owner_public = next(
            user for user in listing.get_json()["users"] if user["username"] == "privacy_owner"
        )
        self.assertEqual(owner_public["email"], "")
        self.assertIsNone(owner_public["email_verified"])

        own_profile = self.client.get("/api/me", headers=self.auth(owner["token"]))
        self.assertEqual(own_profile.get_json()["user"]["email"], "owner@example.test")

    def test_login_rate_limit(self):
        username = "missing_rate_limit_user"
        for _ in range(server.LOGIN_MAX_ATTEMPTS):
            response = self.client.post(
                "/api/login", json={"username": username, "password": "wrong-password"}
            )
            self.assertEqual(response.status_code, 401)
        limited = self.client.post(
            "/api/login", json={"username": username, "password": "wrong-password"}
        )
        self.assertEqual(limited.status_code, 429)
        self.assertIn("Retry-After", limited.headers)

    def test_fake_image_is_rejected(self):
        response = self.client.post(
            "/api/me/photo",
            headers=self.auth(),
            data={"photo": (io.BytesIO(b"this is not a real png"), "fake.png")},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("içeriği", response.get_json()["message"])

    def test_expired_session_is_rejected(self):
        login = self.client.post(
            "/api/login",
            json={"username": "testadmin", "password": "TestAdmin-Only-482!"},
        ).get_json()
        digest = hashlib.sha256(login["token"].encode()).hexdigest()
        expired = (datetime.now() - timedelta(minutes=1)).strftime("%Y-%m-%d %H:%M:%S")
        with server.db() as connection:
            connection.execute(
                "update sessions set expires_at=? where token=?", (expired, digest)
            )
            connection.commit()
        response = self.client.get("/api/me", headers=self.auth(login["token"]))
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
