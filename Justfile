# aometry-repo development tasks
# Install just: https://github.com/casey/just

# Default: show available recipes
default:
    @just --list

# Run typecheck + full test suite (same as CI)
check: typecheck test

# Run all tests
test:
    npm test

# Run tests in watch mode
test-watch:
    npx vitest

# Run a single test file
test-file file:
    npx vitest run {{file}}

# TypeScript typecheck only
typecheck:
    npm run typecheck

# Install dependencies
install:
    npm install

# Show test coverage summary
coverage:
    npx vitest run --coverage

# Bring the bot up locally (copy .env.example → .env first)
up:
    docker compose up

# Bring the bot up in the background
up-detached:
    docker compose up -d

# Stop the bot
down:
    docker compose down

# Pull the latest host image
pull:
    docker compose pull

# Tail bot logs
logs:
    docker compose logs -f bot
