# DOCA Backend

Express and MongoDB API for the privacy-first DOCA skin condition support app.

## Local setup

1. Install packages: `npm.cmd install`
2. Copy `.env.example` to `.env` and keep local secrets out of Git.
3. Start Docker Desktop, then start MongoDB: `docker compose up -d`
4. Seed the condition catalog: `npm.cmd run seed:conditions`
5. Start development mode: `npm.cmd run dev`
6. Open `http://localhost:5000/api/v1/health`.

## API endpoints

- `GET /api/v1/health` - API and database status
- `GET /api/v1/conditions?page=1&limit=20` - condition catalog
- `GET /api/v1/conditions/:slug` - one condition
- `GET /api/v1/conditions/search?q=itchy+red+rash&limit=20` - symptom text search

Catalog content is educational and must not be presented as a diagnosis.

## Commands

- `npm.cmd run dev` - run with Node watch mode
- `npm.cmd start` - run normally
- `npm.cmd test` - run the test suite
- `npm.cmd run seed:conditions` - safely insert or update the starter catalog
- `docker compose up -d` - start the local MongoDB container
- `docker compose down` - stop the local MongoDB container without deleting its data

Firebase authentication, notifications, community features, and peer chat are intentionally outside this foundation.
