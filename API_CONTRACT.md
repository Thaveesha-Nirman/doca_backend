# Doca — API Contract (Home Screen)

**Base URL:** `http://localhost:5000/api`  
*(Use your PC's Wi-Fi IP like `http://192.168.1.X:5000/api` when testing on a real phone)*

**Golden Rule:** Frontend and Backend MUST use these exact field names. Never rename a field without updating this file and telling the group first.

---

## 1. Load Home Screen (Initial Feed)

* **When it happens:** User opens `HomeScreen` (no buttons pressed).
* **API Frontend calls:** `GET /api/posts?filter=For You`
* **What Frontend sends (Request):** Nothing in the body — just calls the URL above.
* **What Backend must return (Response `200 OK`):**
```json
{
  "posts": [
    {
      "id": "6744a1f9c2b8a10012ab34cd",
      "alias": "CalmOtter47",
      "timeAgo": "12 min ago",
      "topic": "Skin irritation",
      "status": "Asking",
      "title": "Has anyone experienced something similar?",
      "body": "I noticed some mild redness after changing my skincare routine.",
      "votes": 24,
      "comments": 8,
      "isSensitive": false
    }
  ]
}
```
*(Valid `status` values: `"Asking"` | `"Ongoing"` | `"Healed"`)*

---

## 2. Create Post Button (`Share a question or recovery update…`)

* **When it happens:** User taps the Create Post box on `HomeScreen`, fills out `CreatePostScreen`, and taps Publish.
* **API Frontend calls:** `POST /api/posts`
* **What Frontend sends (Request Body):**
```json
{
  "alias": "CalmOtter47",
  "topic": "Skin irritation",
  "status": "Asking",
  "title": "Has anyone experienced something similar?",
  "body": "I noticed some mild redness after changing my skincare routine.",
  "isSensitive": false
}
```
*(Note: `alias` is sent temporarily so we can test right now. Once Login is done, Backend will get `alias` from the logged-in user instead.)*
* **What Backend must return (Response `201 Created`):**
```json
{
  "post": {
    "id": "6744a1f9c2b8a10012ab34ce",
    "alias": "CalmOtter47",
    "timeAgo": "Just now",
    "topic": "Skin irritation",
    "status": "Asking",
    "title": "Has anyone experienced something similar?",
    "body": "I noticed some mild redness after changing my skincare routine.",
    "votes": 0,
    "comments": 0,
    "isSensitive": false
  }
}
```

---

## Template: Adding a New Button or Screen (For Frontend)
*Copy this block and add it above whenever you wire a new button or screen:*

### [Button or Screen Name]
* **When it happens:** What user taps or opens
* **API Frontend calls:** `GET / POST / PUT / DELETE /api/...`
* **What Frontend sends (Request):** `{ ... }` *(or None)*
* **What Backend must return (Response):** `{ ... }`

## 3. Sign Up / Save Anonymous Profile (`SignUpScreen`)

* **When it happens:** User signs up with Firebase Auth (Email/Password or Google) and taps "Create Anonymous Profile" with their alias and gender.
* **API Frontend calls:** `POST /api/auth/onboarding`
* **Headers:** `Authorization: Bearer <FIREBASE_ID_TOKEN>`
* **What Frontend sends (Request Body):**
```json
{
  "alias": "CalmOtter47",
  "avatarId": "avatar_01",
  "gender": "Male"
}
```
* **What Backend must return (Response `201 Created`):**
```json
{
  "user": {
    "id": "6744a1f9c2b8a10012ab3401",
    "firebaseUid": "firebase_uid_123",
    "alias": "CalmOtter47",
    "avatarId": "avatar_01",
    "gender": "Male"
  }
}
```

---

## 4. Login Sync (`LoginScreen`)

* **When it happens:** User logs in with Firebase Auth. Flutter sends the token to check if this user already has an anonymous profile in MongoDB.
* **API Frontend calls:** `POST /api/auth/sync`
* **Headers:** `Authorization: Bearer <FIREBASE_ID_TOKEN>`
* **What Frontend sends (Request Body):** `{}` *(Token header provides `firebaseUid`)*
* **What Backend must return (Response `200 OK`):**
```json
{
  "isNewUser": false,
  "user": {
    "id": "6744a1f9c2b8a10012ab3401",
    "firebaseUid": "firebase_uid_123",
    "alias": "CalmOtter47",
    "avatarId": "avatar_01",
    "gender": "Male"
  }
}
```
*(If `isNewUser: true`, `user` is `null` and Flutter navigates to `SignUpScreen` to set an alias.)*

---

## 5. Load Profile Screen (`ProfileScreen`)

* **When it happens:** User opens `ProfileScreen` (no buttons pressed).
* **API Frontend calls:** `GET /api/users/me`
* **Headers:** `Authorization: Bearer <FIREBASE_ID_TOKEN>`
* **What Frontend sends (Request):** Nothing in body — just the auth header.
* **What Backend must return (Response `200 OK`):**
```json
{
  "user": {
    "id": "6744a1f9c2b8a10012ab3401",
    "alias": "CalmOtter47",
    "avatarId": "avatar_01",
    "gender": "Male"
  }
}
```

