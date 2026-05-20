#!/usr/bin/env bash
set -euo pipefail

REPO_NAME="viral-struct-ai"

git init
git add .
git commit -m "chore: initialize viral structure transfer engine"
git branch -M main

echo "Now create GitHub repo and run:"
echo "git remote add origin git@github.com:<your-org-or-name>/${REPO_NAME}.git"
echo "git push -u origin main"
